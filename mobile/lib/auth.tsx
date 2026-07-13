import React, { createContext, useContext, useEffect, useState } from 'react';
import { deleteAuthToken, getAuthToken, setAuthToken } from './storage';
import { api } from './api';

interface AuthContextValue {
  token: string | null;
  loading: boolean;
  signIn: (email: string, password: string) => Promise<void>;
  signUp: (email: string, password: string) => Promise<void>;
  signOut: () => Promise<void>;
}

const AuthContext = createContext<AuthContextValue | null>(null);

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [token, setToken] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    getAuthToken()
      .then((t) => {
        setToken(t);
        setLoading(false);
      })
      .catch(() => setLoading(false));
  }, []);

  async function signIn(email: string, password: string) {
    const { token: t } = await api.login(email, password);
    await setAuthToken(t);
    setToken(t);
  }

  async function signUp(email: string, password: string) {
    const { token: t } = await api.register(email, password);
    await setAuthToken(t);
    setToken(t);
  }

  async function signOut() {
    await deleteAuthToken();
    setToken(null);
  }

  return (
    <AuthContext.Provider value={{ token, loading, signIn, signUp, signOut }}>
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth must be used within AuthProvider');
  return ctx;
}
