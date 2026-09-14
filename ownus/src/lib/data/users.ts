import type { User } from '@/lib/types';

// User identity and profiles are loaded dynamically from PostgreSQL via /auth/me
export const currentUser: User | null = null;
export const teamMembers: User[] = [];
