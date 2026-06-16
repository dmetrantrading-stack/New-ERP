import React, { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '../../store/auth';
import { Eye, EyeOff, Lock, Shield, Cloud, CheckCircle } from 'lucide-react';
import toast from 'react-hot-toast';

const FEATURES = [
  'Inventory Management',
  'Point of Sale (POS)',
  'Purchasing',
  'Accounting',
  'Sales Management',
  'Warehouse Management',
  'HR & Payroll',
  'Financial Reports',
];

export default function LoginPage() {
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [rememberMe, setRememberMe] = useState(false);
  const [capsLock, setCapsLock] = useState(false);
  const [loading, setLoading] = useState(false);
  const [fadeIn, setFadeIn] = useState(false);
  const [logoUrl, setLogoUrl] = useState<string | null>(null);
  const { login, user } = useAuth();
  const navigate = useNavigate();

  useEffect(() => {
    setFadeIn(true);
    if (user) navigate('/');
  }, [user, navigate]);

  useEffect(() => {
    fetch('/api/settings/public')
      .then(r => r.json())
      .then(d => { if (d?.logo_url) setLogoUrl(d.logo_url); })
      .catch(() => {});
  }, []);

  useEffect(() => {
    const savedUser = localStorage.getItem('remembered_user');
    if (savedUser) {
      setUsername(savedUser);
      setRememberMe(true);
    }
  }, []);

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter') handleSubmit(e as any);
    if (e.getModifierState('CapsLock')) setCapsLock(true);
    else setCapsLock(false);
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!username || !password) { toast.error('Please fill in all fields'); return; }
    setLoading(true);
    try {
      await login(username, password);
      if (rememberMe) {
        localStorage.setItem('remembered_user', username);
      } else {
        localStorage.removeItem('remembered_user');
      }
      toast.success('Welcome to D METRAN TRADING ERP');
      navigate('/');
    } catch (err: any) {
      toast.error(err.response?.data?.error || 'Invalid credentials. Please try again.');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className={`min-h-screen flex transition-opacity duration-700 ${fadeIn ? 'opacity-100' : 'opacity-0'}`}>
      {/* LEFT PANEL — Light */}
      <div className="hidden lg:flex lg:w-[60%] relative overflow-hidden bg-gradient-to-br from-white via-gray-50 to-gray-100 flex-col items-center justify-center p-12">
        {/* Decorative green curves */}
        <svg className="absolute bottom-0 left-0 w-[500px] h-[400px] opacity-10" viewBox="0 0 500 400" fill="none">
          <path d="M-50 400 Q100 200 200 350 Q300 500 550 300" stroke="#39B54A" strokeWidth="60" fill="none" opacity="0.4"/>
          <path d="M-100 450 Q50 250 150 400 Q250 550 600 350" stroke="#1E7A34" strokeWidth="40" fill="none" opacity="0.3"/>
        </svg>
        <svg className="absolute top-1/2 right-0 w-[300px] h-[300px] opacity-10" viewBox="0 0 300 300" fill="none">
          <circle cx="200" cy="150" r="120" stroke="#39B54A" strokeWidth="40" fill="none" opacity="0.3"/>
          <circle cx="200" cy="150" r="80" stroke="#1E7A34" strokeWidth="20" fill="none" opacity="0.2"/>
        </svg>

        {/* World map watermark */}
        <div className="absolute inset-0 opacity-[0.04] flex items-center justify-center">
          <svg viewBox="0 0 900 500" className="w-full h-full max-w-3xl">
            <path d="M150,200 Q200,150 250,200 Q300,250 350,200 Q400,150 450,200 Q500,250 550,200 Q600,150 650,200 Q700,250 750,200" stroke="#111" fill="none" strokeWidth="0.5"/>
            <path d="M100,280 Q150,230 200,280 Q250,330 300,280 Q350,230 400,280 Q450,330 500,280 Q550,230 600,280 Q650,330 700,280 Q750,230 800,280" stroke="#111" fill="none" strokeWidth="0.5"/>
            <ellipse cx="250" cy="250" rx="80" ry="40" stroke="#111" fill="none" strokeWidth="0.5"/>
            <ellipse cx="550" cy="220" rx="60" ry="30" stroke="#111" fill="none" strokeWidth="0.5"/>
            <ellipse cx="400" cy="300" rx="50" ry="25" stroke="#111" fill="none" strokeWidth="0.5"/>
          </svg>
        </div>

        {/* Content */}
        <div className="relative z-10 text-center animate-[float_6s_ease-in-out_infinite]">
          {/* Logo */}
          <div className="mb-6">
            {logoUrl ? (
              <img src={logoUrl} alt="D METRAN TRADING" className="inline-block w-24 h-24 rounded-2xl object-contain bg-white shadow-lg shadow-gray-200 mb-4" />
            ) : (
              <div className="inline-flex items-center justify-center w-20 h-20 rounded-2xl bg-gradient-to-br from-[#39B54A] to-[#1E7A34] shadow-lg shadow-green-200 mb-4">
                <span className="text-2xl font-black text-white tracking-tight">DM</span>
              </div>
            )}
          </div>

          {/* Company Name */}
          <h1 className="text-4xl font-black text-gray-900 tracking-[0.2em] mb-1">D METRAN</h1>
          <h1 className="text-4xl font-black text-gray-900 tracking-[0.3em] mb-4">TRADING</h1>

          {/* Tagline */}
          <p className="text-sm text-gray-500 tracking-[0.15em] uppercase mb-12 font-light">
            Global Solutions. Trusted Partners.
          </p>

          {/* Divider */}
          <div className="w-16 h-px bg-gradient-to-r from-transparent via-[#39B54A] to-transparent mx-auto mb-10" />

          {/* Features */}
          <div className="grid grid-cols-2 gap-x-8 gap-y-2.5 text-left max-w-md mx-auto">
            {FEATURES.map((f) => (
              <div key={f} className="flex items-center gap-2 text-gray-500 text-xs">
                <CheckCircle size={12} className="text-[#39B54A] flex-shrink-0" />
                <span className="font-light tracking-wide">{f}</span>
              </div>
            ))}
          </div>
        </div>

        {/* Bottom branding */}
        <div className="absolute bottom-8 left-12 right-12 flex justify-between text-[10px] text-gray-400 z-10">
          <span>© 2026 D METRAN TRADING. All Rights Reserved.</span>
          <span>Version v1.0</span>
        </div>
      </div>

      {/* RIGHT PANEL — Dark Green */}
      <div className="flex-1 flex items-center justify-center p-6 sm:p-12 bg-gradient-to-br from-[#1E7A34] via-[#15803d] to-[#0a2e14] relative overflow-hidden">
        {/* Subtle pattern */}
        <div className="absolute inset-0 opacity-[0.03]">
          <div className="absolute top-10 right-10 w-64 h-64 rounded-full border border-white/20" />
          <div className="absolute bottom-20 left-10 w-48 h-48 rounded-full border border-white/20" />
          <div className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-96 h-96 rounded-full border border-white/10" />
        </div>

        <div className={`relative z-10 w-full max-w-[420px] transition-all duration-700 delay-200 ${fadeIn ? 'translate-y-0 opacity-100' : 'translate-y-8 opacity-0'}`}>
          {/* Header */}
          <div className="mb-6 text-center">
            <h2 className="text-2xl font-bold text-white">Welcome Back!</h2>
            <p className="text-sm text-green-200 mt-1">Sign in to your D METRAN TRADING ERP System</p>
          </div>

          {/* Login Card */}
          <div style={{width:460}} className="mx-auto bg-white rounded-3xl shadow-2xl p-12">
            <form onSubmit={handleSubmit} className="space-y-5">
              {/* Email Address */}
              <div>
                <label className="block text-xs font-semibold text-gray-600 uppercase tracking-wider mb-1.5">
                  Email Address
                </label>
                <input
                  type="text"
                  value={username}
                  onChange={(e) => setUsername(e.target.value)}
                  onKeyDown={handleKeyDown}
                  className="w-full px-4 py-3 bg-gray-50 border border-gray-200 rounded-xl text-sm text-gray-900 placeholder-gray-400
                    focus:outline-none focus:ring-2 focus:ring-[#39B54A]/30 focus:border-[#39B54A] focus:bg-white
                    transition-all duration-200"
                  placeholder="Enter email"
                  autoFocus
                />
              </div>

              {/* Password */}
              <div>
                <label className="block text-xs font-semibold text-gray-600 uppercase tracking-wider mb-1.5">
                  Password
                </label>
                <div className="relative">
                  <input
                    type={showPassword ? 'text' : 'password'}
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                    onKeyDown={handleKeyDown}
                    className="w-full px-4 py-3 pr-12 bg-gray-50 border border-gray-200 rounded-xl text-sm text-gray-900 placeholder-gray-400
                      focus:outline-none focus:ring-2 focus:ring-[#39B54A]/30 focus:border-[#39B54A] focus:bg-white
                      transition-all duration-200"
                    placeholder="Enter password"
                  />
                  <button
                    type="button"
                    onClick={() => setShowPassword(!showPassword)}
                    className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-400 hover:text-gray-600 transition-colors"
                  >
                    {showPassword ? <EyeOff size={18} /> : <Eye size={18} />}
                  </button>
                </div>
              </div>

              {/* Caps Lock Warning */}
              {capsLock && (
                <div className="flex items-center gap-2 text-xs text-amber-600 bg-amber-50 px-3 py-2 rounded-lg">
                  <Lock size={12} />
                  Caps Lock is on
                </div>
              )}

              {/* Remember Me + Forgot Password */}
              <div className="flex items-center justify-between">
                <label className="flex items-center gap-2 cursor-pointer select-none">
                  <input
                    type="checkbox"
                    checked={rememberMe}
                    onChange={(e) => setRememberMe(e.target.checked)}
                    className="w-4 h-4 rounded border-gray-300 text-[#39B54A] focus:ring-[#39B54A]/30"
                  />
                  <span className="text-xs text-gray-500">Remember Me</span>
                </label>
                <button type="button" className="text-xs text-[#39B54A] hover:text-[#1E7A34] font-medium transition-colors">
                  Forgot Password?
                </button>
              </div>

              {/* Login Button */}
              <button
                type="submit"
                disabled={loading}
                className="w-full py-3 bg-gradient-to-r from-[#39B54A] to-[#1E7A34] text-white rounded-xl text-sm font-semibold
                  hover:shadow-lg hover:shadow-green-500/25 hover:-translate-y-0.5
                  disabled:opacity-60 disabled:cursor-not-allowed disabled:hover:translate-y-0
                  transition-all duration-200 flex items-center justify-center gap-2"
              >
                {loading ? (
                  <>
                    <svg className="animate-spin h-4 w-4" viewBox="0 0 24 24">
                      <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" fill="none" />
                      <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
                    </svg>
                    Authenticating...
                  </>
                ) : (
                  'Sign In'
                )}
              </button>

              {/* Register Button */}
              <button
                type="button"
                className="w-full py-3 bg-white border-2 border-[#39B54A] text-[#39B54A] rounded-xl text-sm font-semibold
                  hover:bg-green-50 transition-all duration-200"
              >
                Register Account
              </button>
            </form>
          </div>

          {/* Security badges */}
          <div className="flex justify-center gap-6 mt-6">
            <div className="flex items-center gap-1.5 text-[10px] text-green-300">
              <Lock size={12} />
              Secure Login
            </div>
            <div className="flex items-center gap-1.5 text-[10px] text-green-300">
              <Shield size={12} />
              Data Protected
            </div>
            <div className="flex items-center gap-1.5 text-[10px] text-green-300">
              <Cloud size={12} />
              Cloud Ready
            </div>
          </div>

          {/* Mobile footer */}
          <div className="lg:hidden text-center mt-4 text-[10px] text-green-300">
            D METRAN TRADING ERP &middot; v1.0 &middot; © 2026
          </div>
        </div>
      </div>
    </div>
  );
}
