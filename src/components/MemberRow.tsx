import { useState } from 'react';
import type { FamilyMember, FamilyMemberRole } from '../useFamilyMembers';

type Props = {
  member: FamilyMember;
  isMe: boolean;
  isLastAdmin: boolean;
  onUpdateRole: (memberId: string, role: FamilyMemberRole) => Promise<void>;
  onRemove: (memberId: string) => Promise<void>;
};

const ROLE_LABEL: Record<FamilyMemberRole, string> = {
  admin: 'Admin',
  member: 'Member',
};

const ROLE_DESCRIPTION: Record<FamilyMemberRole, string> = {
  admin: 'Manage members; full editor access',
  member: 'Add, edit, delete movies; mark watched',
};

export default function MemberRow({
  member,
  isMe,
  isLastAdmin,
  onUpdateRole,
  onRemove,
}: Props) {
  const [busy, setBusy] = useState(false);

  async function handleRoleChange(role: FamilyMemberRole) {
    if (member.role === role) return;
    if (isLastAdmin && role !== 'admin') return;
    setBusy(true);
    try {
      await onUpdateRole(member.id, role);
    } catch (e) {
      console.error('[MemberRow] role change failed', e);
    } finally {
      setBusy(false);
    }
  }

  async function handleRemove() {
    if (isLastAdmin) return;
    setBusy(true);
    try {
      await onRemove(member.id);
    } catch (e) {
      console.error('[MemberRow] remove failed', e);
    } finally {
      setBusy(false);
    }
  }

  // user_id stays null until the invitee signs in for the first time
  // and `claim_pending_memberships` binds the row. Surface that state
  // so admins know whether someone has actually accepted yet.
  const pending = member.userId === null;
  const primaryLabel = member.displayName ?? member.email;
  const showSecondaryEmail =
    member.displayName !== null && member.displayName !== member.email;

  return (
    <li className="border-t border-ink-800/70 px-5 py-3.5 flex flex-col gap-2">
      <div className="flex items-baseline justify-between gap-2 flex-wrap">
        <div className="text-[15px] font-semibold text-ink-100 truncate">
          {primaryLabel}
          {isMe && (
            <span className="ml-2 text-[10px] font-mono text-ink-500 uppercase tracking-wider">
              you
            </span>
          )}
          {member.isGlobalOwner && (
            <span className="ml-2 text-[10px] font-mono text-amber-glow uppercase tracking-wider">
              owner
            </span>
          )}
          {pending && (
            <span className="ml-2 text-[10px] font-mono text-amber-glow/90 uppercase tracking-wider">
              invited
            </span>
          )}
        </div>
      </div>
      {showSecondaryEmail && (
        <div className="text-[12px] text-ink-400 truncate">{member.email}</div>
      )}
      <div className="text-[11px] text-ink-500 leading-snug">
        {ROLE_DESCRIPTION[member.role]}
      </div>
      <div className="flex gap-2 items-center">
        <select
          value={member.role}
          onChange={(e) =>
            void handleRoleChange(e.target.value as FamilyMemberRole)
          }
          disabled={busy || isLastAdmin}
          aria-label={`Role for ${member.email}`}
          className="flex-1 h-10 rounded-xl bg-ink-800 border border-ink-700 px-3 text-sm text-ink-100 focus:outline-none focus:border-amber-glow/60 disabled:opacity-60"
          style={{ fontSize: '16px' }}
        >
          <option value="member">{ROLE_LABEL.member}</option>
          <option value="admin">{ROLE_LABEL.admin}</option>
        </select>
        <button
          type="button"
          onClick={() => void handleRemove()}
          disabled={busy || isLastAdmin}
          className="shrink-0 h-10 px-3 rounded-xl bg-ink-800 border border-ink-700 text-xs font-semibold text-crimson-bright active:bg-ink-700 disabled:opacity-50 disabled:text-ink-500"
        >
          Remove
        </button>
      </div>
      {isLastAdmin && (
        <div className="text-[11px] text-ink-500 italic">
          Can&apos;t remove the last admin — promote someone else first.
        </div>
      )}
    </li>
  );
}
