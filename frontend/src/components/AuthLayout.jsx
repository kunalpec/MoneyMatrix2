import brandMark from "../assets/admin-mark.svg";

export default function AuthLayout({ title, subtitle, children, footer }) {
  return (
    <div className="auth-shell">
      <section className="auth-hero">
        <img className="auth-logo" src={brandMark} alt="MoneyMatrix" />
        <p className="eyebrow">MoneyMatrix Admin</p>
        <h1>{title}</h1>
        <p>{subtitle}</p>
      </section>

      <section className="auth-panel">
        <div className="auth-card">{children}</div>
        {footer ? <div className="auth-footer">{footer}</div> : null}
      </section>
    </div>
  );
}
