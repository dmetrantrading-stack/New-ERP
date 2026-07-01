import { Navigate } from 'react-router-dom';

/** Legacy route — permissions live under Settings → Permissions tab */
export default function PermissionsPage() {
  return <Navigate to="/settings?tab=users&section=permissions" replace />;
}
