import { useEffect, useMemo, useRef, useState } from 'react';
import { io } from 'socket.io-client';
import { USERS } from '../data/users';

const EMOJIS = ['💖', '😍', '🥰', '✨', '🌙', '🫶', '💕', '😂', '😌', '🔥'];
const GIFS = [
  'https://media.giphy.com/media/3oEjI6SIIHBdRxXI40/giphy.gif',
  'https://media.giphy.com/media/l0MYt5jPR6QX5pnqM/giphy.gif',
  'https://media.giphy.com/media/26BRuo6sLetdllUtW/giphy.gif',
  'https://media.giphy.com/media/5GoVLqeAOo6PK/giphy.gif',
  'https://media.giphy.com/media/8v5L5w6T8rN7wY8QmQ/giphy.gif',
];

const formatTime = (ts) =>
  new Intl.DateTimeFormat('en-US', {
    hour: 'numeric',
    minute: '2-digit',
  }).format(new Date(ts));

const readJsonResponse = async (response) => {
  const body = await response.text();
  let result = {};

  if (body.trim()) {
    try {
      result = JSON.parse(body);
    } catch {
      throw new Error(`Server returned an invalid response (${response.status}).`);
    }
  }

  if (!response.ok) {
    throw new Error(result.error || `Request failed (${response.status}).`);
  }

  return result;
};

export default function ChatApp() {
  const [loginId, setLoginId] = useState('priya');
  const [password, setPassword] = useState('Game');
  const [currentUser, setCurrentUser] = useState(null);
  const [chatUser, setChatUser] = useState(null);
  const [messages, setMessages] = useState([]);
  const [draft, setDraft] = useState('');
  const [isTyping, setIsTyping] = useState(false);
  const [callState, setCallState] = useState('idle');
  const [theme, setTheme] = useState('rose');
  const [showEmoji, setShowEmoji] = useState(false);
  const [showGif, setShowGif] = useState(false);
  const [error, setError] = useState('');
  const [speed, setSpeed] = useState('fast');
  const socketRef = useRef(null);
  const messageEndRef = useRef(null);
  const peerConnectionRef = useRef(null);
  const localStreamRef = useRef(null);
  const remoteAudioRef = useRef(new Audio());

  const isLoggedIn = Boolean(currentUser && chatUser);

  useEffect(() => {
    fetch('/api/auth/me', { credentials: 'include' })
      .then(async (response) => {
        if (!response.ok) return null;
        const result = await readJsonResponse(response);
        return result.user ? { ...result.user, id: result.user.userId } : null;
      })
      .then((user) => {
        if (!user) return;
        const partner = USERS.find((account) => account.id !== user.id);
        setCurrentUser(user);
        setChatUser(partner || null);
      })
      .catch(() => {});
  }, []);

  useEffect(() => {
    const socket = io({ transports: ['websocket'], withCredentials: true });
    socketRef.current = socket;

    socket.on('new-message', (msg) => {
      const belongsToChat = [msg.senderId, msg.receiverId].includes(currentUser?.id) && [msg.senderId, msg.receiverId].includes(chatUser?.id);
      if (belongsToChat) {
        setMessages((current) => current.some((item) => item.messageId === msg.messageId) ? current : [...current, msg]);
        setSpeed(`${Date.now() - (msg.sentAt || msg.createdAt || Date.now())}ms`);
      }
    });

    socket.on('typing', (payload) => {
      if (payload.userId !== currentUser?.id) {
        setIsTyping(payload.isTyping);
      }
    });

    socket.on('call-status', (status) => {
      setCallState(status.state);
    });

    socket.on('call-signal', async ({ userId, signal }) => {
      if (!peerConnectionRef.current || userId === currentUser?.id) return;

      try {
        await peerConnectionRef.current.setRemoteDescription(new RTCSessionDescription(signal));

        if (signal.type === 'offer') {
          const answer = await peerConnectionRef.current.createAnswer();
          await peerConnectionRef.current.setLocalDescription(answer);
          socket.emit('call-signal', {
            userId: currentUser?.id,
            partnerId: chatUser?.id,
            signal: answer,
          });
        }
      } catch (error) {
        console.error('WebRTC signal error:', error);
      }
    });

    const joinRoom = () => {
      if (currentUser && chatUser) {
        socket.emit('join-room', { partnerId: chatUser.id });
      }
    };

    socket.on('connect', joinRoom);
    if (socket.connected) joinRoom();

    if (currentUser && chatUser) {
      fetch('/api/conversations', { credentials: 'include' })
        .then(readJsonResponse)
        .then(async ({ conversations = [] }) => {
          let conversation = conversations.find((item) => item.otherUserId === chatUser.id);
          if (!conversation) {
            const created = await fetch('/api/conversations', {
              method: 'POST', credentials: 'include', headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ userId: chatUser.id }),
            }).then(readJsonResponse);
            conversation = { conversationId: created.conversationId };
          }
          const history = await fetch(`/api/conversations/${conversation.conversationId}/messages?limit=100`, { credentials: 'include' }).then(readJsonResponse);
          setMessages(history.messages || []);
          socket.emit('join-room', { partnerId: chatUser.id });
        })
        .catch(() => setError('Unable to load your conversation.'));
    }

    return () => {
      socket.off('connect', joinRoom);
      socket.disconnect();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [currentUser?.id, chatUser?.id]);

  useEffect(() => {
    messageEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages]);

  useEffect(() => {
    const cleanup = () => {
      peerConnectionRef.current?.close();
      peerConnectionRef.current = null;
      if (localStreamRef.current) {
        localStreamRef.current.getTracks().forEach((track) => track.stop());
      }
    };

    return cleanup;
  }, []);

  const userList = useMemo(() => USERS, []);

  const createPeerConnection = async () => {
    if (!currentUser || !chatUser) return null;

    const rtcConfig = { iceServers: [{ urls: 'stun:stun.l.google.com:19302' }] };
    const connection = new RTCPeerConnection(rtcConfig);
    peerConnectionRef.current = connection;

    const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
    localStreamRef.current = stream;
    stream.getTracks().forEach((track) => connection.addTrack(track, stream));

    connection.ontrack = (event) => {
      if (event.streams?.[0]) {
        remoteAudioRef.current.srcObject = event.streams[0];
        remoteAudioRef.current.play().catch(() => {});
      }
    };

    connection.onicecandidate = (event) => {
      if (event.candidate && socketRef.current) {
        socketRef.current.emit('call-signal', {
          userId: currentUser.id,
          partnerId: chatUser.id,
          signal: event.candidate,
        });
      }
    };

    return connection;
  };

  const handleLogin = (event) => {
    event.preventDefault();
    const normalizedUserId = loginId.trim().toLowerCase();
    fetch('/api/auth/login', {
      method: 'POST', credentials: 'include', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ userId: normalizedUserId, password }),
    }).then(async (response) => {
      const result = await readJsonResponse(response);
      const user = { ...result.user, id: result.user.userId };
      const partner = USERS.find((account) => account.id !== user.id);
      setCurrentUser(user);
      setChatUser(partner);
      setMessages([]);
      setError('');
      setDraft('');
      setIsTyping(false);
      setCallState('idle');
    }).catch((loginError) => {
      setError(loginError.message);
    });
  };

  const sendMessage = (text, type = 'text') => {
    if (!text || !currentUser || !chatUser) return;

    const value = typeof text === 'string' ? text.trim() : '';
    if (!value && type === 'text') return;

    fetch('/api/messages', {
      method: 'POST', credentials: 'include', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ receiverId: chatUser.id, content: value || text }),
    }).then(async (response) => {
      const result = await readJsonResponse(response);
      setMessages((current) => current.some((item) => item.messageId === result.message.messageId) ? current : [...current, result.message]);
      setDraft('');
      setShowEmoji(false);
      setShowGif(false);
    }).catch((sendError) => setError(sendError.message));
  };

  const handleSubmit = (event) => {
    event.preventDefault();
    sendMessage(draft);
  };

  const handleTyping = (value) => {
    setDraft(value);
    if (socketRef.current && currentUser && chatUser) {
      socketRef.current.emit('typing', { partnerId: chatUser.id, isTyping: value.length > 0 });
    }
  };

  const handleFileUpload = (event) => {
    const file = event.target.files?.[0];
    if (!file) return;

    const reader = new FileReader();
    reader.onload = () => {
      sendMessage(reader.result, 'image');
    };
    reader.readAsDataURL(file);
    event.target.value = '';
  };

  const toggleCall = async () => {
    if (!currentUser || !chatUser) return;

    if (callState === 'idle' || callState === 'ended') {
      setCallState('connecting');
      socketRef.current.emit('call-toggle', {
        userId: currentUser.id,
        partnerId: chatUser.id,
        state: 'connecting',
      });

      const connection = await createPeerConnection();
      const offer = await connection.createOffer();
      await connection.setLocalDescription(offer);
      socketRef.current.emit('call-signal', {
        userId: currentUser.id,
        partnerId: chatUser.id,
        signal: offer,
      });
      return;
    }

    setCallState('ended');
    socketRef.current.emit('call-toggle', {
      userId: currentUser.id,
      partnerId: chatUser.id,
      state: 'ended',
    });
    peerConnectionRef.current?.close();
    peerConnectionRef.current = null;
    if (localStreamRef.current) {
      localStreamRef.current.getTracks().forEach((track) => track.stop());
    }
  };

  const switchTheme = () => {
    setTheme((current) => (current === 'rose' ? 'midnight' : 'rose'));
  };

  const logout = () => {
    fetch('/api/auth/logout', { method: 'POST', credentials: 'include' }).catch(() => {});
    setCurrentUser(null);
    setChatUser(null);
    setMessages([]);
    setDraft('');
    setError('');
    setCallState('idle');
    setIsTyping(false);
    peerConnectionRef.current?.close();
    if (localStreamRef.current) {
      localStreamRef.current.getTracks().forEach((track) => track.stop());
    }
  };

  if (!isLoggedIn) {
    return (
      <div className={`app-shell ${theme}`}>
        <div className="login-panel">
          <div className="login-glow" />
          <div className="login-card">
            <div className="login-header">
              <span className="badge">Private</span>
              <button type="button" className="theme-token" onClick={switchTheme}>✨</button>
            </div>
            <p className="eyebrow">Only for two hearts</p>
            <h1>Whisper Bloom</h1>
            <p className="subtext">A romantic, encrypted space for you and your favorite person.</p>

            <form onSubmit={handleLogin} className="login-form">
              <label>
                Friend ID
                <input
                  type="text"
                  value={loginId}
                  onChange={(event) => setLoginId(event.target.value)}
                  placeholder="Priya"
                  autoComplete="username"
                />
              </label>

              <label>
                Password
                <input
                  type="password"
                  value={password}
                  onChange={(event) => setPassword(event.target.value)}
                  placeholder="Enter your password"
                  autoComplete="current-password"
                />
              </label>

              {error && <div className="error-box">{error}</div>}

              <button type="submit" className="primary-btn">Open the room</button>
            </form>

            <div className="account-list">
              {userList.map((person) => (
                <div key={person.id} className="tiny-user">
                  <span className="dot" style={{ background: person.color }} />
                  <span>{person.name}</span>
                  <small>{person.id}</small>
                </div>
              ))}
            </div>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className={`app-shell ${theme}`}>
      <aside className="sidebar">
        <div className="brand-box">
          <div className="brand-mark">WB</div>
          <div>
            <p className="eyebrow">Our space</p>
            <h2>Whisper Bloom</h2>
          </div>
        </div>

        <div className="profile-card">
          <div className="avatar" style={{ background: currentUser.color }}>{currentUser.name[0]}</div>
          <div>
            <strong>{currentUser.name}</strong>
            <small>{currentUser.status}</small>
          </div>
        </div>

        <div className="contact-list">
          <div className="list-title">Chat with</div>
          <div className="contact-item active">
            <div className="avatar small" style={{ background: chatUser.color }}>{chatUser.name[0]}</div>
            <div>
              <strong>{chatUser.name}</strong>
              <small>{isTyping ? 'typing...' : 'online now'}</small>
            </div>
          </div>
        </div>

        <div className="metrics">
          <div>
            <span>Messages</span>
            <strong>{messages.length}</strong>
          </div>
          <div>
            <span>Latency</span>
            <strong>{speed}</strong>
          </div>
        </div>

        <button className="ghost-btn" onClick={switchTheme}>Change theme</button>
      </aside>

      <main className="chat-panel">
        <header className="chat-header">
          <div className="chat-user">
            <div className="avatar small" style={{ background: chatUser.color }}>{chatUser.name[0]}</div>
            <div>
              <h3>{chatUser.name}</h3>
              <small>{isTyping ? 'typing...' : 'online and ready'}</small>
            </div>
          </div>

          <div className="header-actions">
            <button className="call-btn" onClick={toggleCall}>
              {callState === 'connecting'
                ? 'Connecting...'
                : callState === 'connected'
                  ? 'End call'
                  : 'Voice call'}
            </button>
            <button className="logout-btn" onClick={logout}>Leave</button>
          </div>
        </header>

        <div className="status-bar">
          <div className="status-pill">{callState === 'connected' ? 'Call active' : 'Private room'}</div>
          <div className="status-pill ideal">Encrypted</div>
          <div className="status-pill ideal">{speed}</div>
        </div>

        {callState === 'connected' && (
          <div className="call-panel">
            <div className="call-avatar" style={{ background: chatUser.color }}>{chatUser.name[0]}</div>
            <strong>{chatUser.name}</strong>
            <small>Connected on a secure call</small>
          </div>
        )}

        <div className="messages-box">
          {messages.map((message, index) => {
            const isMine = (message.senderId || message.userId) === currentUser.id;
            return (
              <div key={`${message.createdAt || index}-${index}`} className={`message-row ${isMine ? 'mine' : 'theirs'}`}>
                <div className="bubble-wrap">
                  {message.type === 'image' ? (
                    <img className="message-image" src={message.text} alt="shared" />
                  ) : message.type === 'gif' ? (
                    <img className="gif-message" src={message.text} alt="gif" />
                  ) : (
                    <div className="bubble">{message.text}</div>
                  )}
                  <span className="time-stamp">{formatTime(message.createdAt || Date.now())}</span>
                </div>
              </div>
            );
          })}
          <div ref={messageEndRef} />
        </div>

        <div className="composer-panel">
          {showEmoji && (
            <div className="picker-box">
              {EMOJIS.map((emoji) => (
                <button key={emoji} type="button" onClick={() => sendMessage(emoji)}>{emoji}</button>
              ))}
            </div>
          )}

          {showGif && (
            <div className="picker-box gifs">
              {GIFS.map((gif) => (
                <button key={gif} type="button" onClick={() => sendMessage(gif, 'gif')} className="gif-option">
                  <img src={gif} alt="gif option" />
                </button>
              ))}
            </div>
          )}

          <form onSubmit={handleSubmit} className="composer-form">
            <button type="button" className="tool-btn" onClick={() => setShowEmoji((value) => !value)}>😊</button>
            <button type="button" className="tool-btn" onClick={() => setShowGif((value) => !value)}>GIF</button>
            <label className="upload-btn">
              <input type="file" accept="image/*" onChange={handleFileUpload} />
              📷
            </label>
            <input
              type="text"
              value={draft}
              onChange={(event) => handleTyping(event.target.value)}
              placeholder="Write something sweet..."
            />
            <button type="submit" className="primary-btn">Send</button>
          </form>
        </div>
      </main>
    </div>
  );
}
