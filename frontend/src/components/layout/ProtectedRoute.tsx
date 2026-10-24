import { Navigate, Outlet, useLocation } from 'react-router-dom';
import { useAuth } from '../../context/AuthContext';
import { LoadingState } from '../ui/States';

export default function ProtectedRoute() {
  const { status } = useAuth();
  const location = useLocation();
  if (status === 'loading') return <LoadingState label="Loading your shop…" />;
  if (status === 'anonymous') return <Navigate to="/login" replace state={{ from: location.pathname + location.search }} />;
  return <Outlet />;
}
