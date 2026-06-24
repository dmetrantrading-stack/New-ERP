import React from 'react';
import { ShieldAlert } from 'lucide-react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '../store/auth';
import { getDefaultLandingPath } from '../lib/defaultLandingPath';

export default function AccessDenied() {
  const navigate = useNavigate();
  const { hasPerm, hasAnyPerm } = useAuth();
  const homePath = getDefaultLandingPath(hasPerm, hasAnyPerm);
  const homeLabel = homePath === '/' ? 'Back to Dashboard' : 'Go to Home';

  return (
    <div className="flex items-center justify-center h-[calc(100vh-8rem)]">
      <div className="text-center max-w-md">
        <div className="inline-flex items-center justify-center w-20 h-20 rounded-full bg-red-100 mb-6">
          <ShieldAlert size={40} className="text-red-600" />
        </div>
        <h1 className="text-2xl font-bold text-gray-900 mb-2">Access Denied</h1>
        <p className="text-gray-500 mb-6">You do not have permission to access this page. Please contact your administrator if you believe this is an error.</p>
        <button onClick={() => navigate(homePath)} className="px-6 py-2.5 bg-blue-600 text-white rounded-lg text-sm font-medium hover:bg-blue-700">
          {homeLabel}
        </button>
      </div>
    </div>
  );
}
