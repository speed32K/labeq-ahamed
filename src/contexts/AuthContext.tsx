import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useRef,
  useState,
  type ReactNode,
} from 'react';
import {
  GoogleAuthProvider,
  onAuthStateChanged,
  signInWithPopup,
  signOut,
  type User,
} from 'firebase/auth';
import { auth, googleAuthProvider } from '../lib/firebase';
import { verifyRegisteredGmailInFirestore } from '../lib/firestoreOwnership';
import { validateLoginEmailInput, type LoginAuthorizationRole } from '../lib/ownership';

interface AuthContextValue {
  user: User | null;
  accessRole: LoginAuthorizationRole | null;
  authReady: boolean;
  signingIn: boolean;
  verifyingAccess: boolean;
  authError: string | null;
  signInWithGoogle: () => Promise<void>;
  signInWithEmail: (rawEmail: string) => Promise<void>;
  signOutUser: () => Promise<void>;
  clearAuthError: () => void;
}

const AuthContext = createContext<AuthContextValue | null>(null);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<User | null>(null);
  const [accessRole, setAccessRole] = useState<LoginAuthorizationRole | null>(null);
  const [authReady, setAuthReady] = useState(false);
  const [signingIn, setSigningIn] = useState(false);
  const [verifyingAccess, setVerifyingAccess] = useState(false);
  const [authError, setAuthError] = useState<string | null>(null);
  const authCheckSeqRef = useRef(0);

  useEffect(() => {
    const unsub = onAuthStateChanged(auth, (nextUser) => {
      const checkSeq = ++authCheckSeqRef.current;

      if (!nextUser) {
        setUser(null);
        setAccessRole(null);
        setVerifyingAccess(false);
        setAuthReady(true);
        return;
      }

      setVerifyingAccess(true);

      void (async () => {
        try {
          const eligibility = await verifyRegisteredGmailInFirestore(nextUser);
          if (authCheckSeqRef.current !== checkSeq) return;

          if (eligibility.allowed) {
            setUser(nextUser);
            setAccessRole(eligibility.role);
            setAuthError(null);
          } else {
            setUser(null);
            setAccessRole(null);
            setAuthError(eligibility.message);
            try {
              await signOut(auth);
            } catch (signOutErr) {
              console.warn('Could not sign out unauthorized account:', signOutErr);
            }
          }
        } catch (err) {
          if (authCheckSeqRef.current !== checkSeq) return;
          console.error('Account eligibility verification failed:', err);
          setUser(null);
          setAccessRole(null);
          setAuthError('Could not verify your Gmail account access. Please try again.');
          try {
            await signOut(auth);
          } catch {
            // Ignore secondary sign-out failures
          }
        } finally {
          if (authCheckSeqRef.current === checkSeq) {
            setVerifyingAccess(false);
            setAuthReady(true);
          }
        }
      })();
    });

    return () => unsub();
  }, []);

  const signInWithGoogle = useCallback(async () => {
    setSigningIn(true);
    setAuthError(null);
    try {
      await signInWithPopup(auth, googleAuthProvider);
    } catch (err) {
      const msg =
        err instanceof Error && err.message.includes('popup-closed-by-user')
          ? 'Sign-in popup was closed before completing.'
          : 'Could not complete Google sign-in. Please try again.';
      setAuthError(msg);
      console.error('Google sign-in error:', err);
    } finally {
      setSigningIn(false);
    }
  }, []);

  const signInWithEmail = useCallback(async (rawEmail: string) => {
    const validation = validateLoginEmailInput(rawEmail);
    if (!validation.ok) {
      setAuthError(validation.error);
      return;
    }

    setSigningIn(true);
    setAuthError(null);
    try {
      const provider = new GoogleAuthProvider();
      provider.setCustomParameters({
        prompt: 'select_account',
        login_hint: validation.normalizedEmail,
      });
      await signInWithPopup(auth, provider);
    } catch (err) {
      const msg =
        err instanceof Error && err.message.includes('popup-closed-by-user')
          ? 'Sign-in popup was closed before completing.'
          : err instanceof Error && err.message.includes('popup-blocked')
            ? 'Sign-in popup was blocked by your browser. Please allow popups and try again.'
            : 'Could not complete sign-in for that email address. Please try again.';
      setAuthError(msg);
      console.error('Email-hinted Google sign-in error:', err);
    } finally {
      setSigningIn(false);
    }
  }, []);

  const signOutUser = useCallback(async () => {
    setAuthError(null);
    try {
      await signOut(auth);
    } catch (err) {
      console.error('Sign-out error:', err);
      setAuthError('Could not sign out cleanly. Please try again.');
    }
  }, []);

  const clearAuthError = useCallback(() => setAuthError(null), []);

  return (
    <AuthContext.Provider
      value={{
        user,
        accessRole,
        authReady,
        signingIn,
        verifyingAccess,
        authError,
        signInWithGoogle,
        signInWithEmail,
        signOutUser,
        clearAuthError,
      }}
    >
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth(): AuthContextValue {
  const ctx = useContext(AuthContext);
  if (!ctx) {
    throw new Error('useAuth must be used inside an AuthProvider');
  }
  return ctx;
}
