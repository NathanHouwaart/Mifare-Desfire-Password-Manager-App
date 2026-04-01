import { useEffect, useMemo, useRef, useState } from 'react';
import { Copy, Loader2, RefreshCw, Ticket, Trash2, X } from 'lucide-react';

function formatTime(value: string | null | undefined): string {
  if (!value) return 'Unknown';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return date.toLocaleString();
}

export const InvitesPage = () => {
  const [syncStatus, setSyncStatus] = useState<SyncStatusDto | null>(null);
  const [syncMode, setSyncMode] = useState<'local' | 'synced'>(
    () => (localStorage.getItem('setting-sync-mode') as 'local' | 'synced') ?? 'local'
  );
  const [syncAuthMe, setSyncAuthMe] = useState<SyncAuthMeDto | null>(null);
  const [inviteList, setInviteList] = useState<SyncInviteListItemDto[]>([]);
  const [inviteNote, setInviteNote] = useState('');
  const inviteNoteInputRef = useRef<HTMLInputElement | null>(null);
  const [inviteExpiresIn, setInviteExpiresIn] = useState('24h');
  const [inviteCreateBusy, setInviteCreateBusy] = useState(false);
  const [inviteRevokeBusyId, setInviteRevokeBusyId] = useState<string | null>(null);
  const [inviteToRevoke, setInviteToRevoke] = useState<SyncInviteListItemDto | null>(null);
  const [createdInvite, setCreatedInvite] = useState<SyncInviteTokenDto | null>(null);
  const [feedback, setFeedback] = useState<{ type: 'ok' | 'err'; message: string } | null>(null);

  const setTransientFeedback = (type: 'ok' | 'err', message: string, timeoutMs = 6000) => {
    setFeedback({ type, message });
    window.setTimeout(() => setFeedback(null), timeoutMs);
  };

  const focusInviteNoteInput = () => {
    window.setTimeout(() => inviteNoteInputRef.current?.focus(), 0);
  };

  const openSyncWizard = () => {
    window.dispatchEvent(new CustomEvent('securepass:open-sync-wizard', {
      detail: syncMode === 'synced' ? { mode: 'synced' as const } : {},
    }));
  };

  const refresh = async () => {
    try {
      const status = await window.electron['sync:getStatus']();
      setSyncStatus(status);
      if (!status.loggedIn) {
        setSyncAuthMe(null);
        setInviteList([]);
        return;
      }

      const me = await window.electron['sync:getAuthMe']();
      setSyncAuthMe(me);
      const canManage = me.inviteCreationPolicy === 'any' || me.isAdmin;
      if (!canManage) {
        setInviteList([]);
        return;
      }
      const invites = await window.electron['sync:listInvites']();
      setInviteList(invites);
      setCreatedInvite((current) => {
        if (!current) return current;
        return invites.some((invite) => invite.id === current.id) ? current : null;
      });
    } catch (error) {
      setSyncStatus(null);
      setSyncAuthMe(null);
      setInviteList([]);
      setTransientFeedback('err', error instanceof Error ? error.message : String(error));
    }
  };

  useEffect(() => {
    void refresh();
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    const onSyncModeChanged = (event: Event) => {
      const detail = (event as CustomEvent<{ mode?: 'local' | 'synced' }>).detail;
      if (detail.mode === 'local' || detail.mode === 'synced') {
        setSyncMode(detail.mode);
      }
      void refresh();
    };
    const onSyncApplied = () => {
      void refresh();
    };

    window.addEventListener('securepass:sync-mode-changed', onSyncModeChanged);
    window.addEventListener('securepass:vault-sync-applied', onSyncApplied);

    return () => {
      window.removeEventListener('securepass:sync-mode-changed', onSyncModeChanged);
      window.removeEventListener('securepass:vault-sync-applied', onSyncApplied);
    };
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const canManageInvites = useMemo(
    () => Boolean(syncAuthMe && (syncAuthMe.inviteCreationPolicy === 'any' || syncAuthMe.isAdmin)),
    [syncAuthMe]
  );

  const handleCreateInvite = async () => {
    if (!syncStatus?.loggedIn) {
      setTransientFeedback('err', 'Sign in to sync before creating invites.');
      return;
    }
    if (!canManageInvites) {
      setTransientFeedback('err', 'Only the owner/admin can create invites on this server.');
      return;
    }

    setInviteCreateBusy(true);
    setFeedback(null);
    try {
      const invite = await window.electron['sync:createInvite']({
        note: inviteNote.trim() || undefined,
        expiresIn: inviteExpiresIn.trim() || undefined,
      });
      setCreatedInvite(invite);
      setInviteNote('');
      await refresh();
      setTransientFeedback('ok', 'Invite created. Copy and send it securely.');
      focusInviteNoteInput();
    } catch (error) {
      setTransientFeedback('err', error instanceof Error ? error.message : String(error));
    } finally {
      setInviteCreateBusy(false);
    }
  };

  const handleRevokeInvite = async (id: string) => {
    setInviteRevokeBusyId(id);
    setFeedback(null);
    try {
      await window.electron['sync:revokeInvite']({ id });
      await refresh();
      setCreatedInvite((current) => (current?.id === id ? null : current));
      setInviteToRevoke(null);
      setTransientFeedback('ok', 'Invite revoked.');
      focusInviteNoteInput();
    } catch (error) {
      setTransientFeedback('err', error instanceof Error ? error.message : String(error));
    } finally {
      setInviteRevokeBusyId(null);
    }
  };

  const copyText = async (value: string, label: string) => {
    try {
      await navigator.clipboard.writeText(value);
      setTransientFeedback('ok', `${label} copied.`);
    } catch {
      setTransientFeedback('err', `Could not copy ${label.toLowerCase()}.`);
    }
  };

  const showSyncSetupState = syncMode !== 'synced' || !syncStatus?.configured || !syncStatus.loggedIn;

  return (
    <div className="px-6 py-6 max-w-4xl w-full mx-auto">
      <div className="flex items-start gap-4 mb-5">
        <div className="w-11 h-11 rounded-2xl bg-accent-soft border border-accent-edge flex items-center justify-center shrink-0 mt-0.5">
          <Ticket className="w-5 h-5 text-accent" />
        </div>
        <div className="flex-1 min-w-0">
          <h1 className="text-2xl font-semibold text-hi leading-tight">Invites</h1>
          <p className="text-[14px] text-lo mt-0.5">Manage invite-only account links for sync access</p>
        </div>
      </div>

      <div className="bg-card border border-edge rounded-2xl overflow-hidden divide-y divide-edge">
        {showSyncSetupState ? (
          <div className="px-5 py-5 flex flex-col gap-3">
            <p className="text-[16px] font-medium text-hi">Sync setup required</p>
            <p className="text-[14px] text-lo leading-snug">
              Configure and sign in to sync first. Invite management is available only for signed-in sync accounts.
            </p>
            <div className="flex gap-2">
              <button
                onClick={openSyncWizard}
                className="px-4 py-2.5 rounded-xl text-[15px] font-medium border text-accent border-accent-edge bg-accent-soft hover:opacity-90 transition-all duration-100"
              >
                Open Sync Settings
              </button>
            </div>
          </div>
        ) : (
          <>
            <div className="px-5 py-4 flex items-center justify-between gap-4">
              <div className="min-w-0">
                <p className="text-[16px] font-medium text-hi">Invite Policy</p>
                <p className="text-[14px] text-lo mt-0.5 leading-snug">
                  {syncAuthMe?.inviteCreationPolicy === 'admin'
                    ? 'Only owner/admin can manage invites on this server.'
                    : 'Any authenticated user can manage invites on this server.'}
                </p>
              </div>
              <div className="flex gap-2 flex-wrap shrink-0">
                <span className={`text-[12px] px-2 py-1 rounded-lg border ${
                  syncAuthMe?.inviteCreationPolicy === 'admin'
                    ? 'text-warn border-warn-edge bg-warn-soft'
                    : 'text-ok border-ok-edge bg-ok-soft'
                }`}>
                  {syncAuthMe?.inviteCreationPolicy === 'admin' ? 'Admin Only' : 'Any User'}
                </span>
                <span className={`text-[12px] px-2 py-1 rounded-lg border ${
                  syncAuthMe?.isAdmin
                    ? 'text-ok border-ok-edge bg-ok-soft'
                    : 'text-dim border-edge bg-input'
                }`}>
                  {syncAuthMe?.isAdmin ? 'You Are Admin' : 'Not Admin'}
                </span>
              </div>
            </div>

            {!canManageInvites ? (
              <div className="px-5 py-5">
                <p className="text-[14px] text-lo">Invite management is restricted to the server owner/admin.</p>
              </div>
            ) : (
              <>
                <div className="px-5 py-4 flex flex-col gap-3">
                  <p className="text-[16px] font-medium text-hi">Create Invite</p>
                  <p className="text-[14px] text-lo leading-snug">Create a single-use invite for a new account.</p>
                  <div className="flex gap-2 flex-wrap items-center">
                    <input
                      ref={inviteNoteInputRef}
                      type="text"
                      value={inviteNote}
                      onChange={(event) => setInviteNote(event.target.value)}
                      placeholder="Optional note (e.g. Dad's phone)"
                      className="min-w-[260px] bg-input border border-edge text-hi text-[14px] rounded-xl px-3.5 py-2.5 outline-none focus:border-accent-edge transition-colors"
                    />
                    <input
                      type="text"
                      value={inviteExpiresIn}
                      onChange={(event) => setInviteExpiresIn(event.target.value)}
                      placeholder="24h"
                      className="w-[120px] bg-input border border-edge text-hi text-[14px] rounded-xl px-3.5 py-2.5 outline-none focus:border-accent-edge transition-colors"
                    />
                    <button
                      onClick={handleCreateInvite}
                      disabled={inviteCreateBusy}
                      className="px-4 py-2.5 rounded-xl text-[15px] font-medium border text-accent border-accent-edge bg-accent-soft hover:opacity-90 transition-all duration-100 disabled:opacity-50 disabled:cursor-not-allowed flex items-center gap-2"
                    >
                      {inviteCreateBusy && <Loader2 className="w-4 h-4 animate-spin" />}
                      {inviteCreateBusy ? 'Creating...' : 'Create Invite'}
                    </button>
                    <button
                      onClick={() => void refresh()}
                      className="px-3 py-2.5 rounded-xl text-[14px] font-medium border text-mid border-edge bg-input hover:text-hi transition-all duration-100 flex items-center gap-2"
                    >
                      <RefreshCw className="w-3.5 h-3.5" />
                      Refresh
                    </button>
                  </div>
                  <p className="text-[12px] text-dim">Expiry examples: 12h, 24h, 2d, 7d</p>
                </div>

                {createdInvite && (
                  <div className="px-5 py-4 flex flex-col gap-2">
                    <p className="text-[16px] font-medium text-hi">Latest Invite (shown once)</p>
                    <p className="text-[12px] text-mid break-all">Token: {createdInvite.token}</p>
                    <p className="text-[12px] text-mid break-all">Link: {createdInvite.inviteUrl}</p>
                    <div className="flex gap-2 flex-wrap">
                      <button
                        onClick={() => void copyText(createdInvite.token, 'Invite token')}
                        className="px-3 py-2 rounded-lg text-[13px] font-medium border text-accent border-accent-edge bg-accent-soft hover:opacity-90 transition-all duration-100 flex items-center gap-1.5"
                      >
                        <Copy className="w-3.5 h-3.5" />
                        Copy token
                      </button>
                      <button
                        onClick={() => void copyText(createdInvite.inviteUrl, 'Invite link')}
                        className="px-3 py-2 rounded-lg text-[13px] font-medium border text-accent border-accent-edge bg-accent-soft hover:opacity-90 transition-all duration-100 flex items-center gap-1.5"
                      >
                        <Copy className="w-3.5 h-3.5" />
                        Copy link
                      </button>
                    </div>
                  </div>
                )}

                <div className="px-5 py-4 flex flex-col gap-3">
                  <p className="text-[16px] font-medium text-hi">Your Invites</p>
                  {inviteList.length === 0 ? (
                    <p className="text-[14px] text-lo">No invites created yet.</p>
                  ) : (
                    <div className="space-y-2">
                      {inviteList.map((invite) => (
                        <div key={invite.id} className="rounded-xl border border-edge bg-input px-3.5 py-3 flex items-center justify-between gap-3">
                          <div className="min-w-0">
                            <p className="text-[14px] text-hi truncate font-medium">{invite.note || 'No note'}</p>
                            <p className="text-[12px] text-dim mt-0.5">
                              Expires {formatTime(invite.expiresAt)} · {invite.used ? 'Used' : invite.expired ? 'Expired' : 'Unused'}
                            </p>
                            {invite.usedAt && (
                              <p className="text-[12px] text-dim">Used at {formatTime(invite.usedAt)}</p>
                            )}
                          </div>
                          {!invite.used && !invite.expired && (
                            <button
                              onClick={() => setInviteToRevoke(invite)}
                              disabled={inviteRevokeBusyId === invite.id}
                              className="px-3 py-2 rounded-lg text-[12px] font-medium border text-err border-err-edge bg-err-soft hover:opacity-90 transition-all duration-100 disabled:opacity-50 disabled:cursor-not-allowed shrink-0 flex items-center gap-1.5"
                            >
                              {inviteRevokeBusyId === invite.id && <Loader2 className="w-3.5 h-3.5 animate-spin" />}
                              {inviteRevokeBusyId === invite.id ? 'Revoking...' : 'Revoke'}
                            </button>
                          )}
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              </>
            )}
          </>
        )}

        {feedback && (
          <div className="px-5 py-4">
            <p className={`text-[13px] ${feedback.type === 'ok' ? 'text-ok' : 'text-err'}`}>
              {feedback.message}
            </p>
          </div>
        )}
      </div>

      {inviteToRevoke && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/60 backdrop-blur-sm"
          onMouseDown={(event) => {
            if (event.target !== event.currentTarget) return;
            if (inviteRevokeBusyId === inviteToRevoke.id) return;
            setInviteToRevoke(null);
            focusInviteNoteInput();
          }}
        >
          <div className="bg-card border border-edge rounded-2xl w-full max-w-sm shadow-2xl animate-[fadeSlideUp_0.2s_ease-out]">
            <div className="px-5 py-4 border-b border-edge flex items-center justify-between gap-3">
              <div className="flex items-center gap-2.5 min-w-0">
                <div className="w-10 h-10 rounded-xl bg-err-soft border border-err-edge flex items-center justify-center shrink-0">
                  <Trash2 className="w-5 h-5 text-err" />
                </div>
                <div className="min-w-0">
                  <h2 className="text-[17px] font-semibold text-hi">Revoke invite?</h2>
                  <p className="text-[12px] text-lo mt-0.5">This link token will stop working immediately.</p>
                </div>
              </div>
              <button
                onClick={() => {
                  if (inviteRevokeBusyId === inviteToRevoke.id) return;
                  setInviteToRevoke(null);
                  focusInviteNoteInput();
                }}
                className="w-8 h-8 rounded-lg flex items-center justify-center text-dim hover:text-hi hover:bg-input active:scale-90 transition-all duration-100"
                aria-label="Close revoke dialog"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            <div className="px-5 py-4">
              <p className="text-[14px] text-lo leading-snug">
                {inviteToRevoke.note
                  ? `Invite "${inviteToRevoke.note}" will be revoked.`
                  : 'This invite has no note and will be revoked.'}
              </p>
            </div>

            <div className="px-5 pb-5 flex gap-3">
              <button
                onClick={() => {
                  if (inviteRevokeBusyId === inviteToRevoke.id) return;
                  setInviteToRevoke(null);
                  focusInviteNoteInput();
                }}
                disabled={inviteRevokeBusyId === inviteToRevoke.id}
                className="flex-1 py-2.5 rounded-xl text-[14px] font-medium text-lo bg-input border border-edge hover:text-hi active:scale-[0.98] transition-all duration-100 disabled:opacity-40"
              >
                Cancel
              </button>
              <button
                onClick={() => void handleRevokeInvite(inviteToRevoke.id)}
                disabled={inviteRevokeBusyId === inviteToRevoke.id}
                className="flex-1 py-2.5 rounded-xl text-[14px] font-medium border text-err border-err-edge bg-err-soft hover:opacity-90 active:scale-[0.98] transition-all duration-100 disabled:opacity-50 disabled:cursor-not-allowed flex items-center justify-center gap-2"
              >
                {inviteRevokeBusyId === inviteToRevoke.id && <Loader2 className="w-4 h-4 animate-spin" />}
                {inviteRevokeBusyId === inviteToRevoke.id ? 'Revoking...' : 'Revoke Invite'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
