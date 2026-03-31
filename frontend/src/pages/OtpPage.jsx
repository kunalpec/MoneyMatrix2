import { Link, useNavigate } from "react-router-dom";
import { useState } from "react";
import { useAppDispatch, useAppSelector } from "../app/hooks";
import { clearAuthFeedback, verifyAdminOtp } from "../features/auth/authSlice";
import AuthLayout from "../components/AuthLayout";
import FormInput from "../components/FormInput";

export default function OtpPage() {
  const dispatch = useAppDispatch();
  const navigate = useNavigate();
  const { pendingPhone, status, error, notice } = useAppSelector((state) => state.auth);
  const [otp, setOtp] = useState("");

  const handleSubmit = async (event) => {
    event.preventDefault();
    const result = await dispatch(verifyAdminOtp({ phone: pendingPhone, otp }));

    if (verifyAdminOtp.fulfilled.match(result)) {
      navigate("/dashboard");
    }
  };

  return (
    <AuthLayout
      title="Verify OTP"
      subtitle="Enter the OTP sent to your phone number to activate admin access and create the wallet."
      footer={
        <p>
          Need another number? <Link to="/signup">Back to signup</Link>
        </p>
      }
    >
      <form className="form-stack" onSubmit={handleSubmit}>
        <FormInput
          label="Phone"
          name="phone"
          onChange={() => {}}
          readOnly
          value={pendingPhone}
        />
        <FormInput
          label="OTP"
          name="otp"
          onChange={(event) => {
            dispatch(clearAuthFeedback());
            setOtp(event.target.value);
          }}
          placeholder="6 digit OTP"
          value={otp}
        />

        {notice ? <p className="feedback success">{notice}</p> : null}
        {error ? <p className="feedback error">{error}</p> : null}

        <button
          className="primary-button"
          disabled={!pendingPhone || status === "loading"}
          type="submit"
        >
          {status === "loading" ? "Verifying..." : "Verify and continue"}
        </button>
      </form>
    </AuthLayout>
  );
}
