export type User = {
  id: string;
  name: string;
  email: string;
  createdAt: string;
};

const API_BASE = '/api';

async function parseError(res: Response) {
  const text = await res.text();
  throw new Error(text || `Request failed (${res.status})`);
}

export async function listUsers(): Promise<User[]> {
  const res = await fetch(`${API_BASE}/user`);
  if (!res.ok) await parseError(res);
  return res.json();
}

export async function createUser(input: {
  name: string;
  email: string;
}): Promise<User> {
  const res = await fetch(`${API_BASE}/user`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(input),
  });
  if (!res.ok) await parseError(res);
  return res.json();
}
