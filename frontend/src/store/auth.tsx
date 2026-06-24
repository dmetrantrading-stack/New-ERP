import React, { createContext, useContext, useState, useEffect, useCallback } from 'react';
import api from '../lib/api';
import type { User } from '../types';
import { checkPermission, checkAnyPermission } from '../lib/permissions';

interface AuthContextType {
  user: User | null;
  token: string | null;
  loading: boolean;
  login: (username: string, password: string) => Promise<User>;
  logout: () => void;
  refreshUser: () => Promise<void>;
  hasPerm: (perm: string) => boolean;
  hasAnyPerm: (perms: string[]) => boolean;
}

const AuthContext = createContext<AuthContextType>({} as AuthContextType);

export const AuthProvider = ({ children }: { children: React.ReactNode }) => {
  const [user, setUser] = useState<User | null>(null);
  const [token, setToken] = useState<string | null>(localStorage.getItem('token'));
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (token) {
      api.get('/auth/me')
        .then((res) => setUser(res.data.user))
        .catch(() => { localStorage.removeItem('token'); setToken(null); window.location.href = '/login'; })
        .finally(() => setLoading(false));
    } else {
      setLoading(false);
    }
  }, [token]);

  const login = useCallback(async (username: string, password: string) => {
    const res = await api.post('/auth/login', { username, password });
    const { token: newToken, user: userData } = res.data;
    localStorage.setItem('token', newToken);
    localStorage.setItem('user', JSON.stringify(userData));
    setToken(newToken);
    setUser(userData);
    return userData as User;
  }, []);

  const logout = useCallback(() => {
    api.post('/auth/logout').catch(() => {});
    localStorage.removeItem('token');
    localStorage.removeItem('user');
    setToken(null);
    setUser(null);
  }, []);

  const refreshUser = useCallback(async () => {
    try {
      const res = await api.get('/auth/me');
      setUser(res.data.user);
    } catch { /* ignore */ }
  }, []);

  const hasPerm = useCallback((perm: string) => {
    if (!user) return true;
    if (user.role_name === 'Admin' || user.role_name === 'Owner') return true;
    return checkPermission(user.permissions, perm);
  }, [user]);

  const hasAnyPerm = useCallback((perms: string[]) => {
    if (!user) return true;
    if (user.role_name === 'Admin' || user.role_name === 'Owner') return true;
    return checkAnyPermission(user.permissions, perms);
  }, [user]);

  return (
    <AuthContext.Provider value={{ user, token, loading, login, logout, refreshUser, hasPerm, hasAnyPerm }}>
      {children}
    </AuthContext.Provider>
  );
};

export const useAuth = () => useContext(AuthContext);
