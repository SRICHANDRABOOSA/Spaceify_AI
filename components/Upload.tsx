import React, { useCallback, useEffect, useRef, useState } from "react";
import { useOutletContext } from "react-router";
import { CheckCircle2, ImageIcon, UploadIcon } from "lucide-react";
import AuthRequiredModal from "./AuthRequiredModal";
import {
  PROGRESS_INCREMENT,
  REDIRECT_DELAY_MS,
  PROGRESS_INTERVAL_MS,
} from "../lib/Constants";

interface UploadProps {
  onComplete?: (base64Data: string) => Promise<boolean | void> | boolean | void;
}

const Upload = ({ onComplete }: UploadProps) => {
  const [file, setFile] = useState<File | null>(null);
  const [isDragging, setIsDragging] = useState(false);
  const [progress, setProgress] = useState(0);
  const [isAuthModalOpen, setIsAuthModalOpen] = useState(false);
  const intervalRef = useRef<NodeJS.Timeout | null>(null);
  const timeoutRef = useRef<NodeJS.Timeout | null>(null);

  const { isSignedIn, signIn, notify } = useOutletContext<AuthContext>();

  useEffect(() => {
    return () => {
      if (intervalRef.current) {
        clearInterval(intervalRef.current);
        intervalRef.current = null;
      }
      if (timeoutRef.current) {
        clearTimeout(timeoutRef.current);
        timeoutRef.current = null;
      }
    };
  }, []);

  const showError = useCallback(
    (message: string) => {
      notify(message, "error");
    },
    [notify],
  );

  const promptSignIn = useCallback(() => {
    setIsAuthModalOpen(true);
    showError("Please sign in with Puter before uploading.");
  }, [showError]);

  const handleModalCancel = () => setIsAuthModalOpen(false);

  const handleModalConfirm = async () => {
    try {
      const signedIn = await signIn();

      if (!signedIn) {
        showError("Sign in failed. Please try again.");
        return;
      }

      setIsAuthModalOpen(false);
      notify("Signed in successfully.", "success", 2200);
    } catch {
      showError("Sign in failed. Please try again.");
    }
  };

  const processFile = useCallback(
    (file: File) => {
      if (!isSignedIn) {
        promptSignIn();
        return;
      }

      setFile(file);
      setProgress(0);

      const reader = new FileReader();
      reader.onerror = () => {
        setFile(null);
        setProgress(0);
        showError("Failed to read this image. Please try another file.");
      };
      reader.onloadend = () => {
        const base64Data = reader.result as string;

        intervalRef.current = setInterval(() => {
          setProgress((prev) => {
            const next = prev + PROGRESS_INCREMENT;
            if (next >= 100) {
              if (intervalRef.current) {
                clearInterval(intervalRef.current);
                intervalRef.current = null;
              }
              timeoutRef.current = setTimeout(async () => {
                try {
                  const result = await onComplete?.(base64Data);

                  if (result === false) {
                    setFile(null);
                    setProgress(0);
                    showError(
                      "Upload completed, but project setup failed. Please try again.",
                    );
                  }
                } catch (error) {
                  console.error("Upload completion failed:", error);
                  setFile(null);
                  setProgress(0);
                  showError(
                    "Something went wrong while preparing your 3D view. Please try again.",
                  );
                } finally {
                  timeoutRef.current = null;
                }
              }, REDIRECT_DELAY_MS);
              return 100;
            }
            return next;
          });
        }, PROGRESS_INTERVAL_MS);
      };
      reader.readAsDataURL(file);
    },
    [isSignedIn, onComplete, promptSignIn, showError],
  );

  const handleDragOver = (e: React.DragEvent) => {
    e.preventDefault();
    if (!isSignedIn) return;
    setIsDragging(true);
  };

  const handleDragLeave = () => {
    setIsDragging(false);
  };

  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault();
    setIsDragging(false);

    if (!isSignedIn) {
      promptSignIn();
      return;
    }

    const droppedFile = e.dataTransfer.files[0];
    const allowedTypes = ["image/jpeg", "image/png"];
    if (droppedFile && allowedTypes.includes(droppedFile.type)) {
      processFile(droppedFile);
    } else {
      showError("Please upload a JPG or PNG image.");
    }
  };

  const handleChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    if (!isSignedIn) {
      e.currentTarget.value = "";
      promptSignIn();
      return;
    }

    const selectedFile = e.target.files?.[0];
    const allowedTypes = ["image/jpeg", "image/png"];

    if (!selectedFile) return;

    if (!allowedTypes.includes(selectedFile.type)) {
      showError("Please upload a JPG or PNG image.");
      e.currentTarget.value = "";
      return;
    }

    processFile(selectedFile);
  };

  return (
    <div className="upload">
      {!file ? (
        <div
          className={`dropzone ${isDragging ? "is-dragging" : ""}`}
          onDragOver={handleDragOver}
          onDragLeave={handleDragLeave}
          onDrop={handleDrop}
        >
          <input
            type="file"
            className="drop-input"
            accept=".jpg,.jpeg,.png"
            onChange={handleChange}
          />

          <div className="drop-content">
            <div className="drop-icon">
              <UploadIcon size={20} />
            </div>
            <p>
              {isSignedIn
                ? "Click to upload or just drag and drop"
                : "Sign in or sign up with Puter to upload"}
            </p>
            <p className="help">Maximum file size 50 MB.</p>
          </div>
        </div>
      ) : (
        <div className="upload-status">
          <div className="status-content">
            <div className="status-icon">
              {progress === 100 ? (
                <CheckCircle2 className="check" />
              ) : (
                <ImageIcon className="image" />
              )}
            </div>

            <h3>{file.name}</h3>

            <div className="progress">
              <div className="bar" style={{ width: `${progress}%` }} />

              <p className="status-text">
                {progress < 100 ? "Analyzing Floor Plan..." : "Redirecting..."}
              </p>
            </div>
          </div>
        </div>
      )}

      <AuthRequiredModal
        isOpen={isAuthModalOpen}
        onConfirm={handleModalConfirm}
        onCancel={handleModalCancel}
        title="Sign in to upload"
        description="Uploading floor plans requires a Puter account. Please sign in to continue."
        confirmLabel="Sign In with Puter"
      />
    </div>
  );
};
export default Upload;