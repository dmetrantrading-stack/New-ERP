import React, { useState, useEffect } from 'react';
import { Link, useLocation, useNavigate } from 'react-router-dom';
import { useAuth } from '../../store/auth';
import { getLandingPathForUser } from '../../lib/defaultLandingPath';
import {
  Eye, EyeOff, Lock, Shield, User, LogIn, UserPlus,
  ShoppingCart, Package, BarChart3, Users,
} from 'lucide-react';
import toast from 'react-hot-toast';

const GREEN = '#39B54A';
const GREEN_DARK = '#1B5E34';

const FEATURES = [
  { label: 'Trading', icon: ShoppingCart },
  { label: 'Inventory', icon: Package },
  { label: 'Analytics', icon: BarChart3 },
  { label: 'Business Management', icon: Users },
];

function WorldMapBg() {
  return (
    <svg className="absolute inset-0 w-full h-full opacity-[0.06] text-gray-400" viewBox="0 0 1200 800" preserveAspectRatio="xMidYMid slice">
      <ellipse cx="350" cy="320" rx="120" ry="70" fill="none" stroke="currentColor" strokeWidth="1.2" />
      <ellipse cx="620" cy="280" rx="90" ry="55" fill="none" stroke="currentColor" strokeWidth="1.2" />
      <ellipse cx="880" cy="340" rx="110" ry="65" fill="none" stroke="currentColor" strokeWidth="1.2" />
      <ellipse cx="500" cy="480" rx="80" ry="45" fill="none" stroke="currentColor" strokeWidth="1.2" />
      <path d="M120 400 Q300 320 480 400 T840 400" fill="none" stroke="currentColor" strokeWidth="0.8" />
      <path d="M200 520 Q420 440 640 520 T980 500" fill="none" stroke="currentColor" strokeWidth="0.8" />
    </svg>
  );
}

function GreenWaves() {
  return (
    <svg className="absolute bottom-0 left-0 w-full h-[45%] pointer-events-none" viewBox="0 0 1440 400" preserveAspectRatio="none">
      <path d="M0 280 C240 180 360 320 580 240 C780 170 960 200 1200 300 L1440 220 L1440 400 L0 400 Z" fill={GREEN} opacity="0.85" />
      <path d="M0 320 C200 240 400 360 620 280 C820 400 1000 260 1440 340 L1440 400 L0 400 Z" fill={GREEN_DARK} opacity="0.55" />
      <path d="M0 360 C300 300 500 380 720 320 C920 420 1100 300 1440 360 L1440 400 L0 400 Z" fill="#2d6a4f" opacity="0.35" />
    </svg>
  );
}

export default function LoginPage() {
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [rememberMe, setRememberMe] = useState(false);
  const [capsLock, setCapsLock] = useState(false);
  const [loading, setLoading] = useState(false);
  const [fadeIn, setFadeIn] = useState(false);
  const [logoUrl, setLogoUrl] = useState<string | null>(null);
  const [businessName, setBusinessName] = useState('D METRAN TRADING');
  const [registrationEnabled, setRegistrationEnabled] = useState(false);
  const { login, user } = useAuth();
  const navigate = useNavigate();
  const location = useLocation();
  const registerState = location.state as { registeredUsername?: string; pendingApproval?: boolean } | null;

  useEffect(() => {
    setFadeIn(true);
    if (user) navigate(getLandingPathForUser(user));
  }, [user, navigate]);

  useEffect(() => {
    fetch('/api/settings/public')
      .then((r) => r.json())
      .then((d) => {
        if (d?.logo_url) setLogoUrl(d.logo_url);
        if (d?.business_name) setBusinessName(d.business_name);
      })
      .catch(() => {});
  }, []);

  useEffect(() => {
    fetch('/api/auth/register-config')
      .then((r) => r.json())
      .then((d) => setRegistrationEnabled(Boolean(d?.enabled)))
      .catch(() => setRegistrationEnabled(false));
  }, []);

  useEffect(() => {
    if (registerState?.registeredUsername) {
      setUsername(registerState.registeredUsername);
      if (registerState.pendingApproval) {
        toast('Account created. Wait for administrator approval before signing in.', { duration: 8000 });
      }
      navigate('/login', { replace: true, state: null });
    }
  }, [registerState, navigate]);

  useEffect(() => {
    const savedUser = localStorage.getItem('remembered_user');
    if (savedUser) {
      setUsername(savedUser);
      setRememberMe(true);
    }
  }, []);

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter') handleSubmit(e as unknown as React.FormEvent);
    setCapsLock(e.getModifierState('CapsLock'));
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!username || !password) {
      toast.error('Please fill in all fields');
      return;
    }
    setLoading(true);
    try {
      const userData = await login(username, password);
      if (rememberMe) localStorage.setItem('remembered_user', username);
      else localStorage.removeItem('remembered_user');
      toast.success('Welcome back!');
      navigate(getLandingPathForUser(userData));
    } catch (err: unknown) {
      const msg = (err as { response?: { data?: { error?: string } } })?.response?.data?.error;
      toast.error(msg || 'Invalid credentials. Please try again.');
    } finally {
      setLoading(false);
    }
  };

  const displayName = businessName.toUpperCase().includes('D METRAN')
    ? businessName
    : 'D METRAN TRADING';

  return (
    <div className={`min-h-screen flex flex-col lg:flex-row transition-opacity duration-700 ${fadeIn ? 'opacity-100' : 'opacity-0'}`}>
      {/* LEFT — Branding (from design mockup) */}
      <div className="relative hidden lg:block lg:w-[58%] xl:w-[60%] overflow-hidden bg-white">
        {logoUrl ? (
          <>
            <WorldMapBg />
            <GreenWaves />
            <div className="relative z-10 h-full flex flex-col items-center justify-center px-12 pb-28">
              <img src={logoUrl} alt={displayName} className="w-36 h-36 object-contain mb-8 drop-shadow-md" />
              <h1 className="text-5xl font-black tracking-wide mb-1" style={{ color: GREEN_DARK }}>D METRAN</h1>
              <div className="flex items-center justify-center gap-4 mb-4">
                <span className="h-px w-16 bg-gray-300" />
                <span className="text-lg font-bold tracking-[0.45em] text-gray-500">T R A D I N G</span>
                <span className="h-px w-16 bg-gray-300" />
              </div>
              <p className="text-xs tracking-[0.2em] uppercase text-gray-500 font-medium mb-16">
                Global Solutions. Trusted Partners.
              </p>
              <div className="grid grid-cols-4 gap-6 max-w-xl">
                {FEATURES.map(({ label, icon: Icon }) => (
                  <div key={label} className="flex flex-col items-center gap-2">
                    <div className="w-12 h-12 rounded-full flex items-center justify-center shadow-sm" style={{ backgroundColor: `${GREEN}18`, color: GREEN_DARK }}>
                      <Icon size={22} strokeWidth={1.75} />
                    </div>
                    <span className="text-[11px] font-semibold text-gray-600 text-center leading-tight">{label}</span>
                  </div>
                ))}
              </div>
            </div>
            <p className="absolute bottom-6 left-8 z-10 text-[11px] text-gray-400">
              © {new Date().getFullYear()} D METRAN TRADING. All rights reserved.
            </p>
          </>
        ) : (
          <img
            src="/images/login-brand.png"
            alt="D METRAN TRADING"
            className="absolute top-0 left-0 h-full w-[172%] max-w-none object-cover object-left pointer-events-none select-none"
            draggable={false}
          />
        )}
      </div>

      {/* RIGHT — Login */}
      <div
        className="flex-1 flex flex-col items-center justify-center px-5 py-10 sm:px-8 relative overflow-hidden min-h-[100vh] lg:min-h-0"
        style={{ background: `linear-gradient(160deg, ${GREEN_DARK} 0%, #0f2918 45%, #0a1f12 100%)` }}
      >
        <WorldMapBg />

        {/* Mobile logo */}
        <div className="lg:hidden mb-6 text-center relative z-10">
          <div className="w-20 h-20 mx-auto mb-3 rounded-full flex items-center justify-center" style={{ backgroundColor: `${GREEN}22` }}>
            <Package size={36} style={{ color: GREEN }} />
          </div>
          <p className="text-white font-black text-xl tracking-wide">D METRAN</p>
          <p className="text-white/70 text-xs tracking-[0.35em] mt-1">T R A D I N G</p>
        </div>

        <div className={`relative z-10 w-full max-w-md transition-all duration-700 delay-150 ${fadeIn ? 'translate-y-0 opacity-100' : 'translate-y-6 opacity-0'}`}>
          <div className="text-center mb-6">
            <h2 className="text-2xl sm:text-3xl font-bold text-white">
              Welcome <span style={{ color: GREEN }}>Back!</span>
            </h2>
            <p className="text-sm text-white/75 mt-2">
              Sign in to your {displayName} ERP System
            </p>
          </div>

          <div className="bg-white rounded-2xl shadow-2xl shadow-black/20 px-7 py-8 sm:px-9 sm:py-10">
            <form onSubmit={handleSubmit} className="space-y-5">
              <div>
                <label className="block text-sm font-semibold text-gray-800 mb-1.5">Username</label>
                <div className="relative">
                  <User size={18} className="absolute left-3.5 top-1/2 -translate-y-1/2 text-gray-400" />
                  <input
                    type="text"
                    value={username}
                    onChange={(e) => setUsername(e.target.value)}
                    onKeyDown={handleKeyDown}
                    className="w-full pl-11 pr-4 py-3 border border-gray-200 rounded-lg text-sm text-gray-900 placeholder-gray-400 focus:outline-none focus:ring-2 focus:ring-green-500/25 focus:border-green-500 transition-all"
                    placeholder="Enter your username"
                    autoComplete="username"
                    autoFocus
                  />
                </div>
              </div>

              <div>
                <label className="block text-sm font-semibold text-gray-800 mb-1.5">Password</label>
                <div className="relative">
                  <Lock size={18} className="absolute left-3.5 top-1/2 -translate-y-1/2 text-gray-400" />
                  <input
                    type={showPassword ? 'text' : 'password'}
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                    onKeyDown={handleKeyDown}
                    className="w-full pl-11 pr-11 py-3 border border-gray-200 rounded-lg text-sm text-gray-900 placeholder-gray-400 focus:outline-none focus:ring-2 focus:ring-green-500/25 focus:border-green-500 transition-all"
                    placeholder="Enter your password"
                    autoComplete="current-password"
                  />
                  <button
                    type="button"
                    onClick={() => setShowPassword(!showPassword)}
                    className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-400 hover:text-gray-600 p-0.5"
                    tabIndex={-1}
                  >
                    {showPassword ? <EyeOff size={18} /> : <Eye size={18} />}
                  </button>
                </div>
              </div>

              {capsLock && (
                <div className="flex items-center gap-2 text-xs text-amber-700 bg-amber-50 border border-amber-100 px-3 py-2 rounded-lg">
                  <Lock size={12} />
                  Caps Lock is on
                </div>
              )}

              <div className="flex items-center justify-between pt-0.5">
                <label className="flex items-center gap-2 cursor-pointer select-none">
                  <input
                    type="checkbox"
                    checked={rememberMe}
                    onChange={(e) => setRememberMe(e.target.checked)}
                    className="w-4 h-4 rounded border-gray-300 accent-green-600"
                  />
                  <span className="text-sm text-gray-600">Remember me</span>
                </label>
                <button
                  type="button"
                  onClick={() => toast('Contact your system administrator to reset your password.')}
                  className="text-sm font-medium hover:underline"
                  style={{ color: GREEN_DARK }}
                >
                  Forgot Password?
                </button>
              </div>

              <button
                type="submit"
                disabled={loading}
                className="w-full py-3.5 text-white rounded-lg text-sm font-semibold flex items-center justify-center gap-2 shadow-md hover:shadow-lg hover:brightness-105 disabled:opacity-60 disabled:cursor-not-allowed transition-all"
                style={{ backgroundColor: GREEN }}
              >
                {loading ? (
                  <>
                    <svg className="animate-spin h-4 w-4" viewBox="0 0 24 24">
                      <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" fill="none" />
                      <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
                    </svg>
                    Signing in...
                  </>
                ) : (
                  <>
                    <LogIn size={18} />
                    Login
                  </>
                )}
              </button>

              {registrationEnabled && (
                <>
                  <div className="flex items-center gap-3 py-1">
                    <span className="flex-1 h-px bg-gray-200" />
                    <span className="text-xs text-gray-400 uppercase">or</span>
                    <span className="flex-1 h-px bg-gray-200" />
                  </div>

                  <Link
                    to="/register"
                    className="w-full py-3.5 rounded-lg text-sm font-semibold flex items-center justify-center gap-2 border-2 transition-colors hover:bg-green-50"
                    style={{ borderColor: GREEN, color: GREEN_DARK }}
                  >
                    <UserPlus size={18} />
                    Register Account
                  </Link>
                </>
              )}
            </form>
          </div>

          <div className="flex items-center justify-center gap-2 mt-6 text-xs text-white/70">
            <Shield size={14} className="text-white/80" />
            <span>Secure Login</span>
            <span className="text-white/40">|</span>
            <span>Your data is protected</span>
          </div>
        </div>
      </div>
    </div>
  );
}
