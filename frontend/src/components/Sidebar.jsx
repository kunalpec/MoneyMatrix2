import { NavLink } from "react-router-dom";
import brandMark from "../assets/admin-mark.svg";

const links = [
  { to: "/dashboard", label: "Dashboard" },
  { to: "/users", label: "Users" },
  { to: "/leaderboard", label: "Leaderboard" },
  { to: "/settings", label: "Settings" },
  { to: "/logout", label: "Logout" },
];

export default function Sidebar() {
  return (
    <aside className="sidebar">
      <div className="sidebar-brand">
        <img src={brandMark} alt="MoneyMatrix" />
        <div>
          <strong>MoneyMatrix</strong>
          <span>Admin Control</span>
        </div>
      </div>

      <nav className="sidebar-nav">
        {links.map((link) => (
          <NavLink
            className={({ isActive }) =>
              `sidebar-link${isActive ? " active" : ""}`
            }
            key={link.to}
            to={link.to}
          >
            {link.label}
          </NavLink>
        ))}
      </nav>
    </aside>
  );
}
