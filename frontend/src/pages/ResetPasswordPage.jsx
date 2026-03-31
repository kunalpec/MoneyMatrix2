import { Link, useNavigate } from "react-router-dom";
import { useState } from "react";
import { useAppDispatch, useAppSelector } from "../app/hooks";
import { clearAuthFeedback, resetPassword } from "../features/auth/authSlice";
import AuthLayout from "../components/AuthLayout";
import FormInput from "../components/FormInput";

export default function ResetPasswordPage() {
  const dispatch = useAppDispatch();
  const navigate = useNavigate();
  const { pendingPhone, status, error, notice } = useAppSelector((state) => state.auth);
  const [form, setForm] = useState({
    phone: pendingPhone || "",
    otp: "",
  });

  const updateField = (event) => {
    dispatch(clearAuthFeedback());
    setForm((current) => ({
      ...current,
      [event.target.name]: event.target.value,
    }));
  };

  const handleSubmit = async (event) => {
    event.preventDefault();
    const result = await dispatch(resetPassword(form));

    if (resetPassword.fulfilled.match(result)) {
      navigate("/login");
    }
  };

  return (
    <AuthLayout
      title="Reset password"
      subtitle="Confirm the OTP received on phone to finish the password reset."
      footer={
        <p>
          Back to <Link to="/login">login</Link>
        </p>
      }
    >
      <form className="form-stack" onSubmit={handleSubmit}>
        <FormInput label="Phone" name="phone" onChange={updateField} value={form.phone} />
        <FormInput label="OTP" name="otp" onChange={updateField} value={form.otp} />

        {notice ? <p className="feedback success">{notice}</p> : null}
        {error ? <p className="feedback error">{error}</p> : null}

        <button className="primary-button" disabled={status === "loading"} type="submit">
          {status === "loading" ? "Resetting..." : "Reset password"}
        </button>
      </form>
    </AuthLayout>
  );
}
