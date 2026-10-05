import { z } from 'zod';

const userId = z.string().trim().min(1).max(64).regex(/^[a-zA-Z0-9_-]+$/, 'userId may contain letters, numbers, _ and - only');
const password = z.string().min(8).max(128);

export const registerSchema = z.object({
  userId,
  password,
  name: z.string().trim().min(1).max(80),
  color: z.string().regex(/^#[0-9a-fA-F]{6}$/).optional(),
});

export const loginSchema = z.object({ userId, password: z.string().min(1).max(128) });
export const receiverSchema = z.object({ receiverId: userId, content: z.string().trim().min(1).max(4000) });
export const conversationSchema = z.object({ userId });
export const paginationSchema = z.object({
  limit: z.coerce.number().int().min(1).max(100).default(50),
  before: z.string().uuid().optional(),
});

export const parseBody = (schema, body) => schema.safeParse(body);
