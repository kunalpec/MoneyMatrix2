import { useEffect } from "react";
import { useNavigate } from "react-router-dom";
import { useAppDispatch } from "../app/hooks";
import { clearAdminState } from "../features/admin/adminSlice";
import { logoutAdmin } from "../features/auth/authSlice";

export default function LogoutPage() {
  const dispatch = useAppDispatch();
  const navigate = useNavigate();

  useEffect(() => {
    const run = async () => {
      await dispatch(logoutAdmin());
      dispatch(clearAdminState());
      navigate("/login", { replace: true });
    };

    run();
  }, [dispatch, navigate]);

  return <div className="screen-state">Signing out...</div>;
}
