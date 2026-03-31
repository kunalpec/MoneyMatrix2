import { useEffect } from "react";
import { useAppDispatch, useAppSelector } from "../app/hooks";
import SectionCard from "../components/SectionCard";
import StatusBadge from "../components/StatusBadge";
import { fetchPlatformUsers } from "../features/admin/adminSlice";
import { currency, formatDateTime, formatPhone } from "../utils/format";

export default function UsersPage() {
  const dispatch = useAppDispatch();
  const { users, usersStatus } = useAppSelector((state) => state.admin);

  useEffect(() => {
    dispatch(fetchPlatformUsers());
  }, [dispatch]);

  return (
    <SectionCard
      title="Users"
      description="Signed up users, balances, login state, and live socket presence."
      actions={
        <button className="secondary-button" onClick={() => dispatch(fetchPlatformUsers())} type="button">
          Refresh
        </button>
      }
    >
      <div className="table-wrap">
        <table className="data-table">
          <thead>
            <tr>
              <th>Name</th>
              <th>Phone</th>
              <th>Balance</th>
              <th>Locked</th>
              <th>Signed up</th>
              <th>Login</th>
              <th>Socket</th>
            </tr>
          </thead>
          <tbody>
            {users.map((user) => (
              <tr key={user._id}>
                <td>
                  <strong>{user.name}</strong>
                  <span>{user.email || "No email"}</span>
                </td>
                <td>{formatPhone(user.phone)}</td>
                <td>{currency(user.balance)}</td>
                <td>{currency(user.lockedBalance)}</td>
                <td>{formatDateTime(user.createdAt)}</td>
                <td>
                  <StatusBadge tone={user.isLoggedIn ? "success" : "neutral"}>
                    {user.isLoggedIn ? "Logged in" : "Offline"}
                  </StatusBadge>
                </td>
                <td>
                  <StatusBadge tone={user.isCurrentlyPlaying ? "warning" : "neutral"}>
                    {user.isCurrentlyPlaying ? "Live" : "Idle"}
                  </StatusBadge>
                </td>
              </tr>
            ))}
            {!users.length ? (
              <tr>
                <td className="empty-cell" colSpan="7">
                  {usersStatus === "loading" ? "Loading users..." : "No users found"}
                </td>
              </tr>
            ) : null}
          </tbody>
        </table>
      </div>
    </SectionCard>
  );
}
