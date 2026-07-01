import React, { useEffect, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { useAuth } from '../../store/auth';
import { getLandingPathForUser } from '../../lib/defaultLandingPath';
import api from '../../lib/api';
import {
  Eye, EyeOff, Lock, Shield, User, UserPlus, Mail, Phone, ArrowLeft,
} from 'lucide-react';
import toast from 'react-hot-toast';

const GREEN = '#39B54A';
const GREEN_DARK = '#1B5E34';

export default function RegisterPage() {
  const [form, setForm] = useState({
    username: '',
    password: '',
    confirmPassword: '',
    full_name: '',
    email: '',
    phone: '',
  });
  const [showPassword, setShowPassword] = useState(false);
  const [loading, setLoading] = useState(false);
  const [checking, setChecking] = useState(true);
  const [enabled, setEnabled] = useState(false);
  const [requireApproval, setRequireApproval] = useState(true);
  const [businessName, setBusinessName] = useState('D METRAN TRADING');
  const { user } = useAuth();
  const navigate = useNavigate();

  useEffect(() => {
    if (user) navigate(getLandingPathForUser(user));
  }, [user, navigate]);

  useEffect(() => {
    Promise.all([
      fetch('/api/auth/register-config').then((r) => r.json()),
      fetch('/api/settings/public').then((r) => r.json()),
    ])
      .then(([config, pub]) => {
        setEnabled(Boolean(config?.enabled));
        setRequireApproval(config?.require_approval !== false);
        if (pub?.business_name) setBusinessName(pub.business_name);
      })
      .catch(() => setEnabled(false))
      .finally(() => setChecking(false));
  }, []);

  const update = (field: string, value: string) => setForm((prev) => ({ ...prev, [field]: value }));

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!form.username || !form.password || !form.full_name) {
      toast.error('Username, password, and full name are required');
      return;
    }
    if (form.password !== form.confirmPassword) {
      toast.error('Passwords do not match');
      return;
    }

    setLoading(true);
    try {
      const res = await api.post('/auth/register', {
        username: form.username.trim(),
        password: form.password,
        full_name: form.full_name.trim(),
        email: form.email.trim() || undefined,
        phone: form.phone.trim() || undefined,
      });
      toast.success(res.data?.message || 'Account created');
      navigate('/login', {
        replace: true,
        state: {
          registeredUsername: res.data?.username || form.username.trim(),
          pendingApproval: Boolean(res.data?.pending_approval),
        },
      });
    } catch (err: unknown) {
      const msg = (err as { response?: { data?: { error?: string } } })?.response?.data?.error;
      toast.error(msg || 'Registration failed');
    } finally {
      setLoading(false);
    }
  };

  if (checking) {
    return (
      <div className="min-h-screen flex items-center justify-center" style={{ background: `linear-gradient(160deg, ${GREEN_DARK} 0%, #0f2918 100%)` }}>
        <div className="text-white text-sm">Loading…</div>
      </div>
    );
  }

  if (!enabled) {
    return (
      <div className="min-h-screen flex items-center justify-center px-4" style={{ background: `linear-gradient(160deg, ${GREEN_DARK} 0%, #0f2918 100%)` }}>
        <div className="bg-white rounded-2xl shadow-2xl p-8 max-w-md w-full text-center">
          <h1 className="text-xl font-bold text-gray-900 mb-2">Registration closed</h1>
          <p className="text-sm text-gray-600 mb-6">
            Self-registration is disabled for {businessName}. Contact your administrator to request an account.
          </p>
          <Link
            to="/login"
            className="inline-flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-semibold text-white"
            style={{ backgroundColor: GREEN }}
          >
            <ArrowLeft size={16} />
            Back to login
          </Link>
        </div>
      </div>
    );
  }

  return (
    <div
      className="min-h-screen flex flex-col items-center justify-center px-5 py-10"
      style={{ background: `linear-gradient(160deg, ${GREEN_DARK} 0%, #0f2918 45%, #0a1f12 100%)` }}
    >
      <div className="w-full max-w-md">
        <div className="text-center mb-6">
          <h2 className="text-2xl sm:text-3xl font-bold text-white">
            Create <span style={{ color: GREEN }}>Account</span>
          </h2>
          <p className="text-sm text-white/75 mt-2">
            Register for {businessName}
          </p>
          {requireApproval && (
            <p className="text-xs text-amber-200/90 mt-2 bg-amber-900/20 border border-amber-700/30 rounded-lg px-3 py-2">
              Accounts require administrator approval before you can sign in.
            </p>
          )}
        </div>

        <div className="bg-white rounded-2xl shadow-2xl shadow-black/20 px-7 py-8 sm:px-9 sm:py-10">
          <form onSubmit={handleSubmit} className="space-y-4">
            <div>
              <label className="block text-sm font-semibold text-gray-800 mb-1.5">Full name *</label>
              <div className="relative">
                <User size={18} className="absolute left-3.5 top-1/2 -translate-y-1/2 text-gray-400" />
                <input
                  type="text"
                  value={form.full_name}
                  onChange={(e) => update('full_name', e.target.value)}
                  className="w-full pl-11 pr-4 py-3 border border-gray-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-green-500/25 focus:border-green-500"
                  placeholder="Your full name"
                  autoFocus
                />
              </div>
            </div>

            <div>
              <label className="block text-sm font-semibold text-gray-800 mb-1.5">Username *</label>
              <div className="relative">
                <User size={18} className="absolute left-3.5 top-1/2 -translate-y-1/2 text-gray-400" />
                <input
                  type="text"
                  value={form.username}
                  onChange={(e) => update('username', e.target.value.replace(/\s/g, ''))}
                  className="w-full pl-11 pr-4 py-3 border border-gray-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-green-500/25 focus:border-green-500"
                  placeholder="letters, numbers, underscore"
                  autoComplete="username"
                />
              </div>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <div>
                <label className="block text-sm font-semibold text-gray-800 mb-1.5">Password *</label>
                <div className="relative">
                  <Lock size={18} className="absolute left-3.5 top-1/2 -translate-y-1/2 text-gray-400" />
                  <input
                    type={showPassword ? 'text' : 'password'}
                    value={form.password}
                    onChange={(e) => update('password', e.target.value)}
                    className="w-full pl-11 pr-11 py-3 border border-gray-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-green-500/25 focus:border-green-500"
                    placeholder="Min. 6 characters"
                    autoComplete="new-password"
                  />
                  <button
                    type="button"
                    onClick={() => setShowPassword(!showPassword)}
                    className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-400 hover:text-gray-600"
                    tabIndex={-1}
                  >
                    {showPassword ? <EyeOff size={18} /> : <Eye size={18} />}
                  </button>
                </div>
              </div>
              <div>
                <label className="block text-sm font-semibold text-gray-800 mb-1.5">Confirm *</label>
                <div className="relative">
                  <Lock size={18} className="absolute left-3.5 top-1/2 -translate-y-1/2 text-gray-400" />
                  <input
                    type={showPassword ? 'text' : 'password'}
                    value={form.confirmPassword}
                    onChange={(e) => update('confirmPassword', e.target.value)}
                    className="w-full pl-11 pr-4 py-3 border border-gray-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-green-500/25 focus:border-green-500"
                    placeholder="Repeat password"
                    autoComplete="new-password"
                  />
                </div>
              </div>
            </div>

            <div>
              <label className="block text-sm font-semibold text-gray-800 mb-1.5">Email</label>
              <div className="relative">
                <Mail size={18} className="absolute left-3.5 top-1/2 -translate-y-1/2 text-gray-400" />
                <input
                  type="email"
                  value={form.email}
                  onChange={(e) => update('email', e.target.value)}
                  className="w-full pl-11 pr-4 py-3 border border-gray-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-green-500/25 focus:border-green-500"
                  placeholder="Optional"
                  autoComplete="email"
                />
              </div>
            </div>

            <div>
              <label className="block text-sm font-semibold text-gray-800 mb-1.5">Phone</label>
              <div className="relative">
                <Phone size={18} className="absolute left-3.5 top-1/2 -translate-y-1/2 text-gray-400" />
                <input
                  type="tel"
                  value={form.phone}
                  onChange={(e) => update('phone', e.target.value)}
                  className="w-full pl-11 pr-4 py-3 border border-gray-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-green-500/25 focus:border-green-500"
                  placeholder="Optional"
                  autoComplete="tel"
                />
              </div>
            </div>

            <button
              type="submit"
              disabled={loading}
              className="w-full py-3.5 text-white rounded-lg text-sm font-semibold flex items-center justify-center gap-2 shadow-md hover:brightness-105 disabled:opacity-60"
              style={{ backgroundColor: GREEN }}
            >
              {loading ? 'Creating account…' : (
                <>
                  <UserPlus size={18} />
                  Register
                </>
              )}
            </button>

            <Link
              to="/login"
              className="w-full py-3 rounded-lg text-sm font-semibold flex items-center justify-center gap-2 border-2 hover:bg-green-50 transition-colors"
              style={{ borderColor: GREEN, color: GREEN_DARK }}
            >
              <ArrowLeft size={16} />
              Back to login
            </Link>
          </form>
        </div>

        <div className="flex items-center justify-center gap-2 mt-6 text-xs text-white/70">
          <Shield size={14} />
          <span>Secure registration</span>
        </div>
      </div>
    </div>
  );
}
