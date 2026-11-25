import { useEffect, useState } from 'react';
import {
  Check,
  CheckCircle2,
  Clock,
  LogIn,
  Mail,
  Settings,
  ShieldCheck,
  Sparkles,
  UserCircle,
  UserPlus,
  X,
  XCircle,
} from 'lucide-react';
import { motion } from 'motion/react';
import type { User } from 'firebase/auth';
import { formatRelativeTime } from '../lib/firestoreNotifications';
import {
  ANIMATION_PRESETS,
  canApproveSubKoRequest,
  isPrimaryOwnerEmail,
  isValidGmailAddress,
  normalizeGmailAddress,
  OWNERSHIP_LIMITS,
  PRIMARY_OWNER_KO_EMAIL,
  validateSubKoCandidate,
  type AnimationPreset,
  type ProjectOwnershipConfig,
  type SubKoRequestRecord,
} from '../lib/ownership';

export type ProfileModalTab = 'profile' | 'settings';

interface ProfileSettingsModalProps {
  isOpen: boolean;
  initialTab?: ProfileModalTab;
  user: User | null;
  signingIn: boolean;
  projectConfig: ProjectOwnershipConfig;
  subKoRequests: SubKoRequestRecord[];
  onClose: () => void;
  onSignIn: () => void;
  onSaveProjectAnimation: (preset: AnimationPreset, title: string) => void;
  onSubmitSubKoVerification: (gmailAddress: string) => { ok: boolean; error?: string };
  onReviewSubKoRequest: (requestId: string, decision: 'approved' | 'declined') => void;
  onCancelSubKoRequest: (requestId: string) => void;
}

function ProjectAnimationPreview({
  preset,
  title,
}: {
  preset: AnimationPreset;
  title: string;
}) {
  return (
    <div
      data-testid="project-animation-preview"
      className="relative overflow-hidden rounded-lg border border-slate-200 bg-slate-900 text-white px-4 py-4 min-h-[96px] flex items-center justify-between gap-4"
    >
      <div className="relative z-10 min-w-0">
        <span className="block text-[10px] font-medium uppercase tracking-wider text-emerald-300/90">
          Project Animation Preview
        </span>
        <p className="mt-0.5 text-sm font-semibold truncate">
          {title.trim() || 'Shop Daily Log Workspace'}
        </p>
        <p className="mt-0.5 text-[11px] text-slate-300 truncate">
          Primary Owner (KO): {PRIMARY_OWNER_KO_EMAIL}
        </p>
      </div>

      <div className="relative z-10 w-16 h-12 shrink-0 flex items-center justify-center">
        {preset === 'pulse_orbit' && (
          <div className="relative w-12 h-12 flex items-center justify-center">
            <motion.span
              aria-hidden="true"
              className="absolute inset-0 rounded-full border border-emerald-400/60"
              animate={{ scale: [0.85, 1.15, 0.85], opacity: [0.45, 0.95, 0.45] }}
              transition={{ duration: 2.6, repeat: Infinity, ease: 'easeInOut' }}
            />
            <motion.span
              aria-hidden="true"
              className="w-5 h-5 rounded-full bg-emerald-400"
              animate={{ scale: [1, 1.12, 1] }}
              transition={{ duration: 1.8, repeat: Infinity, ease: 'easeInOut' }}
            />
          </div>
        )}

        {preset === 'ledger_flow' && (
          <div className="flex items-end gap-1.5 h-10" aria-hidden="true">
            {[0.45, 0.9, 0.65, 1].map((h, i) => (
              <motion.span
                key={i}
                className="w-2 rounded-sm bg-emerald-400"
                animate={{ height: [`${Math.round(h * 16)}px`, `${Math.round(h * 38)}px`, `${Math.round(h * 16)}px`] }}
                transition={{
                  duration: 1.5,
                  repeat: Infinity,
                  delay: i * 0.18,
                  ease: 'easeInOut',
                }}
              />
            ))}
          </div>
        )}

        {preset === 'emerald_wave' && (
          <div className="w-14 h-8 overflow-hidden flex items-center" aria-hidden="true">
            <motion.div
              className="flex gap-1.5"
              animate={{ x: [0, -18, 0] }}
              transition={{ duration: 2.4, repeat: Infinity, ease: 'easeInOut' }}
            >
              {[0, 1, 2, 3, 4].map((idx) => (
                <span
                  key={idx}
                  className="w-3 h-3 rounded-full bg-emerald-400/80 shrink-0"
                />
              ))}
            </motion.div>
          </div>
        )}

        {preset === 'none' && (
          <span className="text-[11px] font-mono text-slate-400">Static</span>
        )}
      </div>
    </div>
  );
}

export function ProfileSettingsModal({
  isOpen,
  initialTab = 'profile',
  user,
  signingIn,
  projectConfig,
  subKoRequests,
  onClose,
  onSignIn,
  onSaveProjectAnimation,
  onSubmitSubKoVerification,
  onReviewSubKoRequest,
  onCancelSubKoRequest,
}: ProfileSettingsModalProps) {
  const [activeTab, setActiveTab] = useState<ProfileModalTab>(initialTab);
  const [selectedPreset, setSelectedPreset] = useState<AnimationPreset>(
    projectConfig.animationPreset
  );
  const [animationTitle, setAnimationTitle] = useState<string>(projectConfig.animationTitle);

  // Nested "Add Sub-KO Email" popup state
  const [subKoPopupOpen, setSubKoPopupOpen] = useState(false);
  const [subKoGmailInput, setSubKoGmailInput] = useState('');
  const [subKoError, setSubKoError] = useState<string | null>(null);

  useEffect(() => {
    if (isOpen) {
      setActiveTab(initialTab);
      setSelectedPreset(projectConfig.animationPreset);
      setAnimationTitle(projectConfig.animationTitle);
      setSubKoPopupOpen(false);
      setSubKoGmailInput('');
      setSubKoError(null);
    }
  }, [isOpen, initialTab, projectConfig.animationPreset, projectConfig.animationTitle]);

  useEffect(() => {
    if (!isOpen) return;
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        if (subKoPopupOpen) {
          setSubKoPopupOpen(false);
        } else {
          onClose();
        }
      }
    };
    document.addEventListener('keydown', handleKeyDown);
    return () => document.removeEventListener('keydown', handleKeyDown);
  }, [isOpen, subKoPopupOpen, onClose]);

  if (!isOpen) return null;

  const isPrimaryKO = isPrimaryOwnerEmail(user?.email);
  const isConfirmedSubKo = Boolean(
    user?.email &&
      subKoRequests.some(
        (r) =>
          normalizeGmailAddress(r.subKoEmail) === normalizeGmailAddress(user.email || '') &&
          r.status === 'approved'
      )
  );
  const roleLabel = isPrimaryKO
    ? 'Project Primary Owner (KO)'
    : isConfirmedSubKo
      ? 'Confirmed Sub-KO'
      : user
        ? 'Registered Member'
        : 'Guest Session';

  const pendingCount = subKoRequests.filter((r) => r.status === 'pending').length;
  const gmailValid = isValidGmailAddress(subKoGmailInput);

  const handleOpenSubKoPopup = () => {
    setSubKoGmailInput('');
    setSubKoError(null);
    setSubKoPopupOpen(true);
  };

  const handleVerifyGmailSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    const validation = validateSubKoCandidate(subKoGmailInput, subKoRequests);
    if (!validation.ok) {
      setSubKoError(validation.error);
      return;
    }
    const result = onSubmitSubKoVerification(validation.normalizedEmail);
    if (!result.ok) {
      setSubKoError(result.error || 'Could not initiate verification request.');
      return;
    }
    setSubKoPopupOpen(false);
    setSubKoGmailInput('');
    setSubKoError(null);
  };

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label="Profile and Project Ownership Settings"
      data-testid="profile-modal"
      className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/50 p-3 sm:p-4"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget && !subKoPopupOpen) {
          onClose();
        }
      }}
    >
      <div className="relative w-full max-w-xl max-h-[90vh] flex flex-col bg-white border border-slate-200 rounded-xl shadow-2xl overflow-hidden">
        {/* Header with Profile & Settings navigation buttons */}
        <div className="px-5 py-4 border-b border-slate-200 flex items-center justify-between gap-3 bg-slate-50/70">
          <div className="flex items-center gap-2.5 min-w-0">
            <UserCircle className="w-5 h-5 text-[#1f5e4b] shrink-0" aria-hidden="true" />
            <div className="min-w-0">
              <h2 className="text-base font-semibold text-slate-900 truncate">
                {activeTab === 'profile' ? 'Profile & Project Setup' : 'Project Settings'}
              </h2>
              <p className="text-[11px] text-slate-500 truncate">{roleLabel}</p>
            </div>
          </div>

          <div className="flex items-center gap-1.5 shrink-0">
            <button
              type="button"
              data-testid="profile-tab"
              onClick={() => setActiveTab('profile')}
              className={`inline-flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg text-xs font-medium transition-colors cursor-pointer ${
                activeTab === 'profile'
                  ? 'bg-slate-900 text-white'
                  : 'text-slate-600 hover:text-slate-900 hover:bg-slate-200/70'
              }`}
            >
              <UserCircle className="w-3.5 h-3.5" aria-hidden="true" />
              <span>Profile</span>
            </button>

            <button
              type="button"
              data-testid="profile-settings-tab"
              onClick={() => setActiveTab('settings')}
              className={`inline-flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg text-xs font-medium transition-colors cursor-pointer ${
                activeTab === 'settings'
                  ? 'bg-slate-900 text-white'
                  : 'text-slate-600 hover:text-slate-900 hover:bg-slate-200/70'
              }`}
            >
              <Settings className="w-3.5 h-3.5" aria-hidden="true" />
              <span>Settings</span>
              {pendingCount > 0 && (
                <span className="ml-0.5 px-1.5 py-0.5 rounded-full text-[10px] font-mono bg-amber-100 text-amber-800">
                  {pendingCount}
                </span>
              )}
            </button>

            <button
              type="button"
              onClick={onClose}
              aria-label="Close profile dialog"
              className="p-1.5 text-slate-400 hover:text-slate-700 hover:bg-slate-200/70 rounded-lg transition-colors cursor-pointer"
            >
              <X className="w-4 h-4" aria-hidden="true" />
            </button>
          </div>
        </div>

        {/* Scrollable Modal Body */}
        <div className="p-5 overflow-y-auto space-y-5 flex-1">
          {activeTab === 'profile' ? (
            <>
              {/* Account Registration Status */}
              <section className="rounded-lg border border-slate-200 bg-slate-50/60 p-4 flex flex-wrap items-center justify-between gap-3">
                <div className="min-w-0">
                  <p className="text-xs font-medium text-slate-500">Registered Account</p>
                  <p className="mt-0.5 text-sm font-semibold text-slate-900 truncate">
                    {user ? user.displayName || user.email : 'Not signed in yet'}
                  </p>
                  {user?.email && (
                    <p className="text-xs text-slate-600 font-mono truncate">{user.email}</p>
                  )}
                </div>

                {!user && (
                  <button
                    type="button"
                    disabled={signingIn}
                    onClick={onSignIn}
                    className="inline-flex items-center gap-1.5 px-3 py-2 rounded-lg text-xs font-semibold text-white bg-[#1f5e4b] hover:bg-[#17483a] disabled:opacity-50 transition-colors cursor-pointer"
                  >
                    <LogIn className="w-3.5 h-3.5" aria-hidden="true" />
                    <span>{signingIn ? 'Signing in...' : 'Sign in with Google'}</span>
                  </button>
                )}
              </section>

              {/* Step 1: Project Primary Owner (KO) */}
              <section className="space-y-2">
                <div className="flex items-center justify-between gap-2">
                  <h3 className="text-xs font-semibold uppercase tracking-wide text-slate-700 flex items-center gap-1.5">
                    <ShieldCheck className="w-4 h-4 text-[#1f5e4b]" aria-hidden="true" />
                    <span>Project Primary Owner (KO)</span>
                  </h3>
                  <span className="text-[11px] font-medium text-emerald-700">Designated</span>
                </div>

                <div className="rounded-lg border border-slate-200 bg-white p-3.5 flex flex-wrap items-center justify-between gap-3">
                  <div className="min-w-0">
                    <p
                      data-testid="primary-owner-email"
                      className="text-sm font-semibold font-mono text-slate-900 break-all"
                    >
                      {PRIMARY_OWNER_KO_EMAIL}
                    </p>
                    <p className="mt-0.5 text-xs text-slate-600">
                      All Sub-KO Gmail verification requests are routed to this Primary Owner (KO)
                      for explicit approval.
                    </p>
                  </div>
                  <button
                    type="button"
                    onClick={() => setActiveTab('settings')}
                    className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium text-slate-700 border border-slate-200 hover:bg-slate-50 transition-colors cursor-pointer shrink-0"
                  >
                    <Settings className="w-3.5 h-3.5" aria-hidden="true" />
                    <span>Manage Sub-KO</span>
                  </button>
                </div>
              </section>

              {/* Step 1: Add Animation to Project */}
              <section className="space-y-3">
                <h3 className="text-xs font-semibold uppercase tracking-wide text-slate-700 flex items-center gap-1.5">
                  <Sparkles className="w-4 h-4 text-[#1f5e4b]" aria-hidden="true" />
                  <span>Project Animation</span>
                </h3>

                <ProjectAnimationPreview preset={selectedPreset} title={animationTitle} />

                <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                  {ANIMATION_PRESETS.map((opt) => {
                    const active = selectedPreset === opt.id;
                    return (
                      <button
                        key={opt.id}
                        type="button"
                        data-testid={`animation-preset-${opt.id}`}
                        onClick={() => setSelectedPreset(opt.id)}
                        className={`text-left p-2.5 rounded-lg border transition-colors cursor-pointer ${
                          active
                            ? 'border-[#1f5e4b] bg-emerald-50/50'
                            : 'border-slate-200 bg-white hover:bg-slate-50'
                        }`}
                      >
                        <div className="flex items-center justify-between gap-2">
                          <span className="text-xs font-semibold text-slate-900">{opt.label}</span>
                          {active && (
                            <Check className="w-3.5 h-3.5 text-[#1f5e4b]" aria-hidden="true" />
                          )}
                        </div>
                        <p className="mt-0.5 text-[11px] text-slate-500">{opt.description}</p>
                      </button>
                    );
                  })}
                </div>

                <div>
                  <label
                    htmlFor="project-animation-title"
                    className="block text-xs font-medium text-slate-700 mb-1"
                  >
                    Animation Caption
                  </label>
                  <input
                    id="project-animation-title"
                    type="text"
                    maxLength={OWNERSHIP_LIMITS.MAX_ANIMATION_TITLE_LEN}
                    value={animationTitle}
                    onChange={(e) => setAnimationTitle(e.target.value)}
                    placeholder="Shop Daily Log Workspace"
                    className="w-full px-3 py-2 text-xs border border-slate-200 rounded-lg bg-white text-slate-900 focus:outline-none focus:border-[#1f5e4b]"
                  />
                </div>

                <div className="flex justify-end">
                  <button
                    type="button"
                    data-testid="save-project-animation-button"
                    onClick={() => onSaveProjectAnimation(selectedPreset, animationTitle)}
                    className="inline-flex items-center gap-1.5 px-4 py-2 rounded-lg text-xs font-semibold text-white bg-[#1f5e4b] hover:bg-[#17483a] transition-colors cursor-pointer"
                  >
                    <Sparkles className="w-3.5 h-3.5" aria-hidden="true" />
                    <span>Save Project Animation</span>
                  </button>
                </div>
              </section>
            </>
          ) : (
            /* Settings Tab: Step 2 - Adding a Sub-KO & Primary Owner Approval Queue */
            <>
              <section className="rounded-lg border border-slate-200 bg-slate-50/60 p-4 flex flex-wrap items-center justify-between gap-3">
                <div className="min-w-0 flex-1">
                  <h3 className="text-sm font-semibold text-slate-900">
                    Secondary Owner (Sub-KO) Access
                  </h3>
                  <p className="mt-0.5 text-xs text-slate-600 leading-relaxed">
                    Submit a Gmail account to request the Sub-KO role. A verification request will
                    be sent to the Project Primary Owner (KO) at{' '}
                    <span className="font-mono font-medium text-slate-800">
                      {PRIMARY_OWNER_KO_EMAIL}
                    </span>{' '}
                    for explicit approval.
                  </p>
                </div>

                <button
                  type="button"
                  data-testid="add-subko-button"
                  onClick={handleOpenSubKoPopup}
                  className="inline-flex items-center gap-1.5 px-3.5 py-2 rounded-lg text-xs font-semibold text-white bg-[#1f5e4b] hover:bg-[#17483a] transition-colors whitespace-nowrap shrink-0 cursor-pointer"
                >
                  <UserPlus className="w-3.5 h-3.5" aria-hidden="true" />
                  <span>Add Sub-KO</span>
                </button>
              </section>

              {/* Verification Requests & Approval Queue */}
              <section className="space-y-2.5">
                <div className="flex items-center justify-between gap-2">
                  <h3 className="text-xs font-semibold uppercase tracking-wide text-slate-700">
                    Sub-KO Verification Requests ({subKoRequests.length})
                  </h3>
                  {isPrimaryKO && (
                    <span className="text-[11px] font-semibold text-[#1f5e4b]">
                      KO Approval Controls Active
                    </span>
                  )}
                </div>

                {subKoRequests.length === 0 ? (
                  <div className="rounded-lg border border-dashed border-slate-200 p-6 text-center">
                    <Mail className="w-5 h-5 text-slate-400 mx-auto" aria-hidden="true" />
                    <p className="mt-2 text-xs font-medium text-slate-700">
                      No Sub-KO requests yet
                    </p>
                    <p className="mt-0.5 text-[11px] text-slate-500">
                      Click <strong className="text-slate-700">Add Sub-KO</strong> to enter a Gmail
                      account and initiate verification with {PRIMARY_OWNER_KO_EMAIL}.
                    </p>
                  </div>
                ) : (
                  <ul className="space-y-2" data-testid="subko-request-list">
                    {subKoRequests.map((req) => {
                      const canApprove = canApproveSubKoRequest(user?.email, req);
                      const canCancelOwn =
                        req.status === 'pending' &&
                        ((!user && req.requestedByUid === 'local') ||
                          (user && req.requestedByUid === user.uid));

                      return (
                        <li
                          key={req.id}
                          className="rounded-lg border border-slate-200 bg-white p-3.5 flex flex-col gap-2.5"
                        >
                          <div className="flex flex-wrap items-start justify-between gap-2">
                            <div className="min-w-0">
                              <p className="text-xs font-semibold font-mono text-slate-900 break-all">
                                {req.subKoEmail}
                              </p>
                              <p className="mt-0.5 text-[11px] text-slate-500">
                                Requested by {req.requestedByName} ·{' '}
                                {formatRelativeTime(req.createdAtMs)}
                              </p>
                            </div>

                            {req.status === 'approved' ? (
                              <span className="inline-flex items-center gap-1 text-[11px] font-semibold text-emerald-700">
                                <CheckCircle2 className="w-3.5 h-3.5" aria-hidden="true" />
                                <span>Confirmed Sub-KO</span>
                              </span>
                            ) : req.status === 'declined' ? (
                              <span className="inline-flex items-center gap-1 text-[11px] font-semibold text-red-700">
                                <XCircle className="w-3.5 h-3.5" aria-hidden="true" />
                                <span>Declined</span>
                              </span>
                            ) : (
                              <span className="inline-flex items-center gap-1 text-[11px] font-semibold text-amber-700">
                                <Clock className="w-3.5 h-3.5" aria-hidden="true" />
                                <span>Pending KO Approval</span>
                              </span>
                            )}
                          </div>

                          {req.status === 'pending' && (
                            <div className="pt-2 border-t border-slate-100 flex flex-wrap items-center justify-between gap-2">
                              <span className="text-[11px] text-slate-500">
                                Verification sent to{' '}
                                <strong className="font-mono text-slate-700">
                                  {req.primaryOwnerEmail}
                                </strong>
                              </span>

                              <div className="flex items-center gap-1.5">
                                {canApprove && (
                                  <>
                                    <button
                                      type="button"
                                      data-testid={`approve-subko-${req.id}`}
                                      onClick={() => onReviewSubKoRequest(req.id, 'approved')}
                                      className="inline-flex items-center gap-1 px-2.5 py-1.5 rounded-md text-[11px] font-semibold text-white bg-[#1f5e4b] hover:bg-[#17483a] transition-colors cursor-pointer"
                                    >
                                      <Check className="w-3 h-3" aria-hidden="true" />
                                      <span>Approve Sub-KO</span>
                                    </button>
                                    <button
                                      type="button"
                                      data-testid={`decline-subko-${req.id}`}
                                      onClick={() => onReviewSubKoRequest(req.id, 'declined')}
                                      className="inline-flex items-center gap-1 px-2.5 py-1.5 rounded-md text-[11px] font-medium text-red-700 border border-red-200 hover:bg-red-50 transition-colors cursor-pointer"
                                    >
                                      <X className="w-3 h-3" aria-hidden="true" />
                                      <span>Decline</span>
                                    </button>
                                  </>
                                )}
                                {!canApprove && canCancelOwn && (
                                  <button
                                    type="button"
                                    onClick={() => onCancelSubKoRequest(req.id)}
                                    className="px-2.5 py-1 rounded-md text-[11px] font-medium text-slate-600 hover:text-red-700 hover:bg-red-50 transition-colors cursor-pointer"
                                  >
                                    Cancel
                                  </button>
                                )}
                              </div>
                            </div>
                          )}
                        </li>
                      );
                    })}
                  </ul>
                )}
              </section>
            </>
          )}
        </div>

        {/* Nested Pop-up Dialog: "Add Sub-KO Email" */}
        {subKoPopupOpen && (
          <div
            role="dialog"
            aria-modal="true"
            aria-label="Add Sub-KO Email"
            data-testid="add-subko-modal"
            className="absolute inset-0 z-20 flex items-center justify-center bg-slate-900/55 p-4"
            onMouseDown={(e) => {
              if (e.target === e.currentTarget) setSubKoPopupOpen(false);
            }}
          >
            <form
              onSubmit={handleVerifyGmailSubmit}
              className="w-full max-w-md bg-white border border-slate-200 rounded-xl shadow-2xl overflow-hidden"
            >
              <div className="px-4 py-3.5 border-b border-slate-200 flex items-center justify-between gap-2 bg-slate-50/70">
                <h3 className="text-sm font-semibold text-slate-900">Add Sub-KO Email</h3>
                <button
                  type="button"
                  onClick={() => setSubKoPopupOpen(false)}
                  aria-label="Close Add Sub-KO Email popup"
                  className="p-1 text-slate-400 hover:text-slate-700 rounded-md cursor-pointer"
                >
                  <X className="w-4 h-4" aria-hidden="true" />
                </button>
              </div>

              <div className="p-4 space-y-3">
                <div>
                  <label
                    htmlFor="subko-gmail-input"
                    className="block text-xs font-medium text-slate-700 mb-1"
                  >
                    Gmail Account
                  </label>
                  <input
                    id="subko-gmail-input"
                    data-testid="subko-email-input"
                    type="email"
                    autoFocus
                    required
                    value={subKoGmailInput}
                    onChange={(e) => {
                      setSubKoGmailInput(e.target.value);
                      if (subKoError) setSubKoError(null);
                    }}
                    placeholder="subko.operator@gmail.com"
                    className="w-full px-3 py-2 text-sm border border-slate-200 rounded-lg bg-white text-slate-900 placeholder:text-slate-400 focus:outline-none focus:border-[#1f5e4b]"
                  />
                  <p className="mt-1.5 text-[11px] text-slate-500 leading-relaxed">
                    Enter a valid <span className="font-mono">@gmail.com</span> address. Clicking{' '}
                    <strong className="text-slate-700">Verify Gmail</strong> sends a verification
                    request to the Project Primary Owner (KO) at{' '}
                    <span className="font-mono text-slate-700">{PRIMARY_OWNER_KO_EMAIL}</span> for
                    explicit approval.
                  </p>
                </div>

                {subKoError && (
                  <p
                    role="alert"
                    className="text-xs text-red-700 bg-red-50 border border-red-200 rounded-lg px-3 py-2"
                  >
                    {subKoError}
                  </p>
                )}
              </div>

              <div className="px-4 py-3 border-t border-slate-100 bg-slate-50/50 flex items-center justify-end gap-2">
                <button
                  type="button"
                  onClick={() => setSubKoPopupOpen(false)}
                  className="px-3 py-2 rounded-lg text-xs font-medium text-slate-700 bg-white border border-slate-200 hover:bg-slate-50 transition-colors cursor-pointer"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  data-testid="verify-gmail-button"
                  disabled={!gmailValid}
                  className="inline-flex items-center gap-1.5 px-3.5 py-2 rounded-lg text-xs font-semibold text-white bg-[#1f5e4b] hover:bg-[#17483a] disabled:opacity-45 disabled:cursor-not-allowed transition-colors cursor-pointer"
                >
                  <ShieldCheck className="w-3.5 h-3.5" aria-hidden="true" />
                  <span>Verify Gmail</span>
                </button>
              </div>
            </form>
          </div>
        )}
      </div>
    </div>
  );
}
