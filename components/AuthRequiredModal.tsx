import { useEffect } from "react";
import { createPortal } from "react-dom";
import Button from "./ui/Button";

const AuthRequiredModal = ({
  isOpen,
  onConfirm,
  onCancel,
  title = "Sign in required",
  description = "Please sign in with Puter to continue this action.",
  confirmLabel = "Sign In",
}: AuthRequiredModalProps) => {
  useEffect(() => {
    if (!isOpen || typeof document === "undefined") return;

    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";

    return () => {
      document.body.style.overflow = previousOverflow;
    };
  }, [isOpen]);

  if (!isOpen) return null;
  if (typeof document === "undefined") return null;

  return createPortal(
    <div className="auth-modal" role="dialog" aria-modal="true">
      <div className="panel">
        <h3>{title}</h3>
        <p>{description}</p>

        <div className="actions">
          <Button className="confirm" onClick={onConfirm} fullWidth>
            {confirmLabel}
          </Button>

          <Button
            variant="ghost"
            className="cancel"
            onClick={onCancel}
            fullWidth
          >
            Cancel
          </Button>
        </div>
      </div>
    </div>,
    document.body,
  );
};

export default AuthRequiredModal;