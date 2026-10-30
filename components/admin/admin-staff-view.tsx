"use client";

import * as React from "react";
import {
  ShieldCheck,
  User,
  RotateCcw,
  AlertCircle,
  X,
  Phone,
  AlertTriangle,
  Plus,
  Pencil,
  Trash2,
  Eye,
  EyeOff,
  Mail,
} from "lucide-react";
import type { AdminStaffMember, StaffOrganizationalRole } from "@/lib/admin/types";
import {
  createStaffMemberAction,
  updateStaffMemberAction,
  removeStaffMemberAction,
} from "@/lib/admin/actions";

interface AdminStaffViewProps {
  staff: AdminStaffMember[];
  currentUserEmail?: string | null;
  currentUserId?: string | null;
  onActionSuccess: () => void;
}

export function AdminStaffView({
  staff,
  currentUserEmail,
  currentUserId,
  onActionSuccess,
}: AdminStaffViewProps) {
  // Modal states
  const [isAddOpen, setIsAddOpen] = React.useState(false);
  const [editingStaff, setEditingStaff] = React.useState<AdminStaffMember | null>(null);
  const [removingStaff, setRemovingStaff] = React.useState<AdminStaffMember | null>(null);

  // Form states - Add
  const [addName, setAddName] = React.useState("");
  const [addEmail, setAddEmail] = React.useState("");
  const [addPassword, setAddPassword] = React.useState("");
  const [addPhone, setAddPhone] = React.useState("");
  const [addRole, setAddRole] = React.useState<StaffOrganizationalRole | "">("");
  const [showAddPassword, setShowAddPassword] = React.useState(false);

  // Form states - Edit
  const [editName, setEditName] = React.useState("");
  const [editEmail, setEditEmail] = React.useState("");
  const [editPhone, setEditPhone] = React.useState("");
  const [editRole, setEditRole] = React.useState<StaffOrganizationalRole | "">("");
  const [editPassword, setEditPassword] = React.useState("");
  const [showEditPassword, setShowEditPassword] = React.useState(false);

  // Status states
  const [isSubmitting, setIsSubmitting] = React.useState(false);
  const [errorMessage, setErrorMessage] = React.useState<string | null>(null);

  const handleOpenAdd = () => {
    setAddName("");
    setAddEmail("");
    setAddPassword("");
    setAddPhone("");
    setAddRole("");
    setShowAddPassword(false);
    setErrorMessage(null);
    setIsAddOpen(true);
  };

  const handleOpenEdit = (member: AdminStaffMember) => {
    setEditingStaff(member);
    setEditName(member.full_name || "");
    setEditEmail(member.email || "");
    setEditPhone(member.phone || "");
    setEditRole(member.organizational_role || "");
    setEditPassword("");
    setShowEditPassword(false);
    setErrorMessage(null);
  };

  const handleOpenRemove = (member: AdminStaffMember) => {
    setRemovingStaff(member);
    setErrorMessage(null);
  };

  const handleCloseModals = () => {
    setIsAddOpen(false);
    setEditingStaff(null);
    setRemovingStaff(null);
    setErrorMessage(null);
  };

  // Submit Add
  const handleAddSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setErrorMessage(null);

    if (!addName.trim()) {
      setErrorMessage("Please enter the staff member's name.");
      return;
    }
    if (!addEmail.trim()) {
      setErrorMessage("Please enter an email address.");
      return;
    }
    if (!addPassword || addPassword.length < 6) {
      setErrorMessage("Password must be at least 6 characters.");
      return;
    }

    setIsSubmitting(true);
    const res = await createStaffMemberAction({
      name: addName.trim(),
      email: addEmail.trim(),
      password: addPassword,
      phone: addPhone.trim() || null,
      role: addRole || null,
    });
    setIsSubmitting(false);

    if (!res.success) {
      setErrorMessage(res.error || "Failed to create staff member.");
      return;
    }

    handleCloseModals();
    onActionSuccess();
  };

  // Submit Edit
  const handleEditSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!editingStaff) return;
    setErrorMessage(null);

    if (!editName.trim()) {
      setErrorMessage("Please enter the staff member's name.");
      return;
    }
    if (!editEmail.trim()) {
      setErrorMessage("Please enter an email address.");
      return;
    }
    if (editPassword && editPassword.length < 6) {
      setErrorMessage("New password must be at least 6 characters.");
      return;
    }

    setIsSubmitting(true);
    const res = await updateStaffMemberAction({
      user_id: editingStaff.user_id,
      name: editName.trim(),
      email: editEmail.trim(),
      phone: editPhone.trim() || null,
      role: editRole || null,
      password: editPassword.trim() || undefined,
    });
    setIsSubmitting(false);

    if (!res.success) {
      setErrorMessage(res.error || "Failed to update staff member.");
      return;
    }

    handleCloseModals();
    onActionSuccess();
  };

  // Submit Remove
  const handleRemoveSubmit = async () => {
    if (!removingStaff) return;
    setErrorMessage(null);

    if (removingStaff.user_id === currentUserId) {
      setErrorMessage("You cannot remove your own administrator account.");
      return;
    }

    setIsSubmitting(true);
    const res = await removeStaffMemberAction({
      user_id: removingStaff.user_id,
    });
    setIsSubmitting(false);

    if (!res.success) {
      setErrorMessage(res.error || "Unable to remove staff member. Please try again.");
      return;
    }

    handleCloseModals();
    onActionSuccess();
  };

  return (
    <div className="space-y-4">
      {/* Top action bar */}
      <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-3">
        <div>
          <h2 className="font-heading text-lg font-bold text-foreground">
            Staff Team
          </h2>
          <p className="text-xs text-muted-foreground">
            Manage staff members and portal access.
          </p>
        </div>
        <div className="flex items-center gap-3">
          {currentUserEmail && (
            <span className="hidden sm:inline text-xs text-muted-foreground">
              Logged in as: <strong className="text-foreground">{currentUserEmail}</strong>
            </span>
          )}
          <button
            type="button"
            onClick={handleOpenAdd}
            className="h-9 px-3.5 rounded-sm bg-caramel text-white text-xs font-semibold hover:bg-caramel/90 flex items-center gap-1.5 transition-colors cursor-pointer"
          >
            <Plus className="size-4" />
            <span>Add Staff</span>
          </button>
        </div>
      </div>

      {/* Staff directory table */}
      <div className="rounded-sm border border-border bg-card overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-left text-xs">
            <thead className="border-b border-border bg-muted/40 text-muted-foreground">
              <tr>
                <th className="py-2.5 px-3 font-semibold">Staff Member</th>
                <th className="py-2.5 px-3 font-semibold">Phone</th>
                <th className="py-2.5 px-3 font-semibold">Role</th>
                <th className="py-2.5 px-3 font-semibold text-right">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border">
              {staff.length === 0 ? (
                <tr>
                  <td colSpan={4} className="py-8 text-center text-muted-foreground">
                    No active staff members found. Click &quot;Add Staff&quot; to create one.
                  </td>
                </tr>
              ) : (
                staff.map((member) => {
                  const isSelf = member.user_id === currentUserId;
                  const displayRole =
                    member.role === "ADMIN"
                      ? "Admin"
                      : member.organizational_role || "Staff";

                  return (
                    <tr
                      key={member.user_id}
                      className="hover:bg-muted/20 transition-colors"
                    >
                      <td className="py-2.5 px-3">
                        <div className="flex items-center gap-2.5">
                          <div
                            className={`size-8 rounded-sm flex items-center justify-center shrink-0 ${
                              member.role === "ADMIN"
                                ? "bg-amber-100 text-amber-900 dark:bg-amber-950 dark:text-amber-300"
                                : "bg-muted text-muted-foreground"
                            }`}
                          >
                            {member.role === "ADMIN" ? (
                              <ShieldCheck className="size-4" />
                            ) : (
                              <User className="size-4" />
                            )}
                          </div>
                          <div>
                            <div className="font-semibold text-foreground flex items-center gap-1.5">
                              <span>{member.full_name || "Bakery Staff Member"}</span>
                              {isSelf && (
                                <span className="px-1.5 py-0.2 rounded text-[10px] font-bold bg-caramel/15 text-caramel">
                                  You
                                </span>
                              )}
                            </div>
                            <div className="text-[11px] text-muted-foreground flex items-center gap-1 mt-0.5">
                              <Mail className="size-3 text-muted-foreground shrink-0" />
                              <span>{member.email || "No email"}</span>
                            </div>
                          </div>
                        </div>
                      </td>

                      <td className="py-2.5 px-3 text-muted-foreground">
                        {member.phone ? (
                          <div className="flex items-center gap-1">
                            <Phone className="size-3 text-muted-foreground shrink-0" />
                            <span>{member.phone}</span>
                          </div>
                        ) : (
                          "—"
                        )}
                      </td>

                      <td className="py-2.5 px-3">
                        <span
                          className={`inline-block px-2 py-0.5 rounded text-[11px] font-semibold ${
                            member.role === "ADMIN"
                              ? "border border-amber-300 bg-amber-100 text-amber-900 dark:border-amber-700 dark:bg-amber-950 dark:text-amber-200"
                              : "bg-muted text-foreground"
                          }`}
                        >
                          {displayRole}
                        </span>
                      </td>

                      <td className="py-2.5 px-3 text-right">
                        <div className="inline-flex items-center gap-1.5">
                          <button
                            type="button"
                            onClick={() => handleOpenEdit(member)}
                            className="h-7 px-2.5 rounded border border-border bg-background text-xs font-semibold text-foreground hover:bg-muted transition-colors flex items-center gap-1 cursor-pointer"
                          >
                            <Pencil className="size-3 text-muted-foreground" />
                            <span>Edit</span>
                          </button>
                          {!isSelf && (
                            <button
                              type="button"
                              onClick={() => handleOpenRemove(member)}
                              className="h-7 px-2.5 rounded border border-destructive/30 bg-background text-xs font-semibold text-destructive hover:bg-destructive hover:text-white transition-colors flex items-center gap-1 cursor-pointer"
                              title={`Remove ${member.full_name || "staff member"}`}
                            >
                              <Trash2 className="size-3" />
                              <span>Remove</span>
                            </button>
                          )}
                        </div>
                      </td>
                    </tr>
                  );
                })
              )}
            </tbody>
          </table>
        </div>
      </div>

      {/* Add Staff Modal */}
      {isAddOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4">
          <div className="relative w-full max-w-md rounded-sm border border-border bg-card p-6 shadow-xl space-y-4">
            <div className="flex items-center justify-between border-b border-border pb-3">
              <div>
                <h3 className="font-heading font-bold text-base text-foreground">
                  Add Staff Member
                </h3>
                <p className="text-xs text-muted-foreground mt-0.5">
                  Create a new account for staff to log into the Staff Portal.
                </p>
              </div>
              <button
                type="button"
                onClick={handleCloseModals}
                className="text-muted-foreground hover:text-foreground cursor-pointer"
              >
                <X className="size-4" />
              </button>
            </div>

            {errorMessage && (
              <div className="flex items-center gap-2 p-2.5 rounded text-xs bg-destructive/10 text-destructive border border-destructive/20">
                <AlertCircle className="size-4 shrink-0" />
                <span>{errorMessage}</span>
              </div>
            )}

            <form onSubmit={handleAddSubmit} className="space-y-3.5 text-xs">
              <div>
                <label className="block font-semibold text-foreground mb-1">
                  Full Name *
                </label>
                <input
                  type="text"
                  required
                  value={addName}
                  onChange={(e) => setAddName(e.target.value)}
                  placeholder="e.g. Ramesh Kumar"
                  className="w-full h-9 px-3 rounded-sm border border-border bg-background text-foreground focus:outline-none focus:ring-1 focus:ring-caramel"
                />
              </div>

              <div>
                <label className="block font-semibold text-foreground mb-1">
                  Email Address *
                </label>
                <input
                  type="email"
                  required
                  value={addEmail}
                  onChange={(e) => setAddEmail(e.target.value)}
                  placeholder="staff@nammabakery.com"
                  className="w-full h-9 px-3 rounded-sm border border-border bg-background text-foreground focus:outline-none focus:ring-1 focus:ring-caramel"
                />
              </div>

              <div>
                <label className="block font-semibold text-foreground mb-1">
                  Password * (min 6 characters)
                </label>
                <div className="relative">
                  <input
                    type={showAddPassword ? "text" : "password"}
                    required
                    minLength={6}
                    value={addPassword}
                    onChange={(e) => setAddPassword(e.target.value)}
                    placeholder="••••••••"
                    className="w-full h-9 pl-3 pr-9 rounded-sm border border-border bg-background text-foreground focus:outline-none focus:ring-1 focus:ring-caramel"
                  />
                  <button
                    type="button"
                    onClick={() => setShowAddPassword((prev) => !prev)}
                    aria-label={showAddPassword ? "Hide password" : "Show password"}
                    className="absolute right-2 top-1/2 -translate-y-1/2 p-1 text-muted-foreground hover:text-foreground cursor-pointer"
                  >
                    {showAddPassword ? (
                      <EyeOff className="size-3.5" />
                    ) : (
                      <Eye className="size-3.5" />
                    )}
                  </button>
                </div>
              </div>

              <div>
                <label className="block font-semibold text-foreground mb-1">
                  Phone Number (optional)
                </label>
                <input
                  type="tel"
                  value={addPhone}
                  onChange={(e) => setAddPhone(e.target.value)}
                  placeholder="9876543210"
                  className="w-full h-9 px-3 rounded-sm border border-border bg-background text-foreground focus:outline-none focus:ring-1 focus:ring-caramel"
                />
              </div>

              <div>
                <label className="block font-semibold text-foreground mb-1">
                  Role (optional)
                </label>
                <select
                  value={addRole}
                  onChange={(e) =>
                    setAddRole(e.target.value as StaffOrganizationalRole | "")
                  }
                  className="w-full h-9 px-3 rounded-sm border border-border bg-background text-foreground focus:outline-none focus:ring-1 focus:ring-caramel"
                >
                  <option value="">Standard Staff</option>
                  <option value="Manager">Manager</option>
                  <option value="Staff">Staff</option>
                  <option value="Chef">Chef</option>
                </select>
                <p className="text-[11px] text-muted-foreground mt-1">
                  All staff roles access the kitchen queue and order management at /staff.
                </p>
              </div>

              <div className="flex items-center justify-end gap-2 pt-3 border-t border-border">
                <button
                  type="button"
                  onClick={handleCloseModals}
                  disabled={isSubmitting}
                  className="h-9 px-3 rounded-sm border border-border bg-background text-foreground font-semibold hover:bg-muted cursor-pointer"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={isSubmitting}
                  className="h-9 px-4 rounded-sm bg-caramel text-white font-semibold hover:bg-caramel/90 flex items-center gap-1.5 disabled:opacity-50 cursor-pointer"
                >
                  {isSubmitting && <RotateCcw className="size-3.5 animate-spin" />}
                  <span>Add Staff</span>
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Edit Staff Modal */}
      {editingStaff && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4">
          <div className="relative w-full max-w-md rounded-sm border border-border bg-card p-6 shadow-xl space-y-4">
            <div className="flex items-center justify-between border-b border-border pb-3">
              <div>
                <h3 className="font-heading font-bold text-base text-foreground">
                  Edit Staff Member
                </h3>
                <p className="text-xs text-muted-foreground mt-0.5">
                  Update staff profile information and credentials.
                </p>
              </div>
              <button
                type="button"
                onClick={handleCloseModals}
                className="text-muted-foreground hover:text-foreground cursor-pointer"
              >
                <X className="size-4" />
              </button>
            </div>

            {errorMessage && (
              <div className="flex items-center gap-2 p-2.5 rounded text-xs bg-destructive/10 text-destructive border border-destructive/20">
                <AlertCircle className="size-4 shrink-0" />
                <span>{errorMessage}</span>
              </div>
            )}

            <form onSubmit={handleEditSubmit} className="space-y-3.5 text-xs">
              <div>
                <label className="block font-semibold text-foreground mb-1">
                  Full Name *
                </label>
                <input
                  type="text"
                  required
                  value={editName}
                  onChange={(e) => setEditName(e.target.value)}
                  className="w-full h-9 px-3 rounded-sm border border-border bg-background text-foreground focus:outline-none focus:ring-1 focus:ring-caramel"
                />
              </div>

              <div>
                <label className="block font-semibold text-foreground mb-1">
                  Email Address *
                </label>
                <input
                  type="email"
                  required
                  value={editEmail}
                  onChange={(e) => setEditEmail(e.target.value)}
                  className="w-full h-9 px-3 rounded-sm border border-border bg-background text-foreground focus:outline-none focus:ring-1 focus:ring-caramel"
                />
              </div>

              <div>
                <label className="block font-semibold text-foreground mb-1">
                  Phone Number (optional)
                </label>
                <input
                  type="tel"
                  value={editPhone}
                  onChange={(e) => setEditPhone(e.target.value)}
                  className="w-full h-9 px-3 rounded-sm border border-border bg-background text-foreground focus:outline-none focus:ring-1 focus:ring-caramel"
                />
              </div>

              <div>
                <label className="block font-semibold text-foreground mb-1">
                  Role (optional)
                </label>
                <select
                  value={editRole}
                  onChange={(e) =>
                    setEditRole(e.target.value as StaffOrganizationalRole | "")
                  }
                  className="w-full h-9 px-3 rounded-sm border border-border bg-background text-foreground focus:outline-none focus:ring-1 focus:ring-caramel"
                >
                  <option value="">Standard Staff</option>
                  <option value="Manager">Manager</option>
                  <option value="Staff">Staff</option>
                  <option value="Chef">Chef</option>
                </select>
              </div>

              <div>
                <label className="block font-semibold text-foreground mb-1">
                  New Password (optional)
                </label>
                <div className="relative">
                  <input
                    type={showEditPassword ? "text" : "password"}
                    value={editPassword}
                    onChange={(e) => setEditPassword(e.target.value)}
                    placeholder="Leave blank to keep current password"
                    minLength={6}
                    className="w-full h-9 pl-3 pr-9 rounded-sm border border-border bg-background text-foreground focus:outline-none focus:ring-1 focus:ring-caramel"
                  />
                  <button
                    type="button"
                    onClick={() => setShowEditPassword((prev) => !prev)}
                    aria-label={showEditPassword ? "Hide password" : "Show password"}
                    className="absolute right-2 top-1/2 -translate-y-1/2 p-1 text-muted-foreground hover:text-foreground cursor-pointer"
                  >
                    {showEditPassword ? (
                      <EyeOff className="size-3.5" />
                    ) : (
                      <Eye className="size-3.5" />
                    )}
                  </button>
                </div>
                <p className="text-[11px] text-muted-foreground mt-1">
                  Only fill this if you want to reset the staff member&apos;s login password.
                </p>
              </div>

              <div className="flex items-center justify-end gap-2 pt-3 border-t border-border">
                <button
                  type="button"
                  onClick={handleCloseModals}
                  disabled={isSubmitting}
                  className="h-9 px-3 rounded-sm border border-border bg-background text-foreground font-semibold hover:bg-muted cursor-pointer"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={isSubmitting}
                  className="h-9 px-4 rounded-sm bg-caramel text-white font-semibold hover:bg-caramel/90 flex items-center gap-1.5 disabled:opacity-50 cursor-pointer"
                >
                  {isSubmitting && <RotateCcw className="size-3.5 animate-spin" />}
                  <span>Save Changes</span>
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Remove Staff Confirmation Modal */}
      {removingStaff && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4">
          <div className="relative w-full max-w-md rounded-sm border border-border bg-card p-6 shadow-xl space-y-4">
            <div className="flex items-start gap-3">
              <div className="size-9 rounded-full bg-destructive/10 text-destructive flex items-center justify-center shrink-0">
                <AlertTriangle className="size-5" />
              </div>
              <div className="flex-1">
                <h3 className="font-heading font-bold text-base text-foreground">
                  Remove Staff Member?
                </h3>
                <p className="text-xs text-muted-foreground mt-2 leading-relaxed">
                  Are you sure you want to remove{" "}
                  <strong className="text-foreground">
                    {removingStaff.full_name || removingStaff.email || "this staff member"}
                  </strong>{" "}
                  from the Staff Team?
                </p>
                <p className="text-xs text-muted-foreground mt-1.5 leading-relaxed">
                  They will no longer be able to access the Staff Portal.
                </p>
              </div>
            </div>

            {errorMessage && (
              <div className="flex items-center gap-2 p-2.5 rounded text-xs bg-destructive/10 text-destructive border border-destructive/20">
                <AlertCircle className="size-4 shrink-0" />
                <span>{errorMessage}</span>
              </div>
            )}

            <div className="flex items-center justify-end gap-2 pt-3 border-t border-border">
              <button
                type="button"
                onClick={handleCloseModals}
                disabled={isSubmitting}
                className="h-9 px-3 rounded-sm border border-border bg-background text-foreground font-semibold hover:bg-muted cursor-pointer"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={handleRemoveSubmit}
                disabled={isSubmitting || removingStaff.user_id === currentUserId}
                className="h-9 px-4 rounded-sm bg-destructive text-white font-semibold hover:bg-destructive/90 flex items-center gap-1.5 disabled:opacity-50 cursor-pointer"
              >
                {isSubmitting && <RotateCcw className="size-3.5 animate-spin" />}
                <span>Remove Staff</span>
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
