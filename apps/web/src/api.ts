const API_URL = (import.meta.env.VITE_API_URL as string) || 'http://localhost:3000';

let accessToken: string | null = localStorage.getItem('token');

export function getToken() {
  return accessToken;
}
export function setToken(token: string | null) {
  accessToken = token;
  if (token) localStorage.setItem('token', token);
  else localStorage.removeItem('token');
}

export interface ApiError extends Error {
  status: number;
}

async function request<T>(method: string, path: string, body?: unknown): Promise<T> {
  const res = await fetch(API_URL + path, {
    method,
    headers: {
      ...(body ? { 'content-type': 'application/json' } : {}),
      ...(accessToken ? { authorization: `Bearer ${accessToken}` } : {}),
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  const text = await res.text();
  const data = text ? JSON.parse(text) : null;
  if (!res.ok) {
    const err = new Error(data?.message || res.statusText) as ApiError;
    err.status = res.status;
    throw err;
  }
  return data as T;
}

// --- types ---
export interface User {
  id: string;
  username: string;
  displayName: string;
}
export interface Photo {
  thumbnailStatus: 'pending' | 'processing' | 'ready' | 'failed';
  thumbnailUrl: string;
  originalUrl: string;
}
export interface Post {
  id: string;
  caption: string;
  likesCount: number;
  likedByViewer?: boolean;
  createdAt: string;
  user?: User;
  photo: Photo | null;
}
export interface Page<T> {
  items: T[];
  nextCursor: string | null;
}
export interface Profile {
  id: string;
  username: string;
  displayName: string;
  bio: string;
  postsCount: number;
  followersCount: number;
  followingCount: number;
  isSelf: boolean;
  isFollowing: boolean;
}
export interface Notification {
  id: string;
  type: string;
  entityType: string;
  entityId: string;
  readAt: string | null;
  createdAt: string;
  actor: User;
}

export const api = {
  apiUrl: API_URL,

  register: (b: { email: string; username: string; password: string; displayName: string }) =>
    request<{ accessToken: string; user: { id: string; username: string } }>('POST', '/auth/register', b),
  login: (b: { email: string; password: string }) =>
    request<{ accessToken: string; user: { id: string; username: string } }>('POST', '/auth/login', b),
  me: () => request<User & { email: string; bio: string }>('GET', '/me'),

  feed: (cursor?: string) => request<Page<Post>>('GET', `/feed${cursor ? `?cursor=${cursor}` : ''}`),
  explore: (cursor?: string) => request<Page<Post>>('GET', `/explore${cursor ? `?cursor=${cursor}` : ''}`),

  createUpload: (b: { mimeType: string; sizeBytes: number; caption?: string }) =>
    request<{ postId: string; uploadUrl: string; key: string }>('POST', '/posts', b),
  finalize: (postId: string) => request<Post>('POST', `/posts/${postId}/finalize`),
  getPost: (postId: string) => request<Post>('GET', `/posts/${postId}`),
  deletePost: (postId: string) => request<{ deleted: boolean }>('DELETE', `/posts/${postId}`),

  like: (postId: string) => request<{ liked: boolean; likesCount: number }>('POST', `/posts/${postId}/like`),
  unlike: (postId: string) => request<{ liked: boolean; likesCount: number }>('DELETE', `/posts/${postId}/like`),

  profile: (username: string) => request<Profile>('GET', `/users/${username}`),
  userPosts: (username: string, cursor?: string) =>
    request<Page<Post>>('GET', `/users/${username}/posts${cursor ? `?cursor=${cursor}` : ''}`),
  follow: (username: string) => request<{ following: boolean }>('POST', `/users/${username}/follow`),
  unfollow: (username: string) => request<{ following: boolean }>('DELETE', `/users/${username}/follow`),

  notifications: (cursor?: string) =>
    request<Page<Notification>>('GET', `/notifications${cursor ? `?cursor=${cursor}` : ''}`),
  unreadCount: () => request<{ count: number }>('GET', '/notifications/unread-count'),
  markAllRead: () => request<{ ok: boolean }>('POST', '/notifications/read-all'),

  /** Direct signed PUT to object storage (bypasses the API, like R2/CDN). */
  uploadToStorage: async (url: string, file: File) => {
    const res = await fetch(url, { method: 'PUT', headers: { 'content-type': file.type }, body: file });
    if (!res.ok) throw new Error(`falha no envio: ${res.status}`);
  },
};
