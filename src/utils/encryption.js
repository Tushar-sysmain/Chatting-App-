export const encryptMessage = (message) => {
  const key = 'whisper-bloom';
  let output = '';

  for (let i = 0; i < message.length; i += 1) {
    const code = message.charCodeAt(i) + key.charCodeAt(i % key.length);
    output += String.fromCharCode(code);
  }

  return btoa(unescape(encodeURIComponent(output)));
};

export const decryptMessage = (message) => {
  try {
    const key = 'whisper-bloom';
    const decoded = decodeURIComponent(escape(atob(message)));
    let output = '';

    for (let i = 0; i < decoded.length; i += 1) {
      const code = decoded.charCodeAt(i) - key.charCodeAt(i % key.length);
      output += String.fromCharCode(code);
    }

    return output;
  } catch {
    return message;
  }
};
