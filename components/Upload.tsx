import { CheckCircle2, ImageIcon, UploadIcon } from "lucide-react";
import React, { useCallback, useEffect, useRef, useState } from "react";
import { useOutletContext } from "react-router";
import {
  PROGRESS_INCREMENT,
  PROGRESS_INTERVAL_MS,
  REDIRECT_DELAY_MS,
} from "../lib/Constants";

type UploadProps = {
  onComplete?: (base64Data: string) => Promise<boolean | void> | boolean | void;
};

const Upload = ({ onComplete }: UploadProps) => {
  const [file, setFile] = useState<File | null>(null);
  const [isDragging, setIsDragging] = useState(false);
  const [progress, setProgress] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const timeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const { isSignedIn, signIn } = useOutletContext<AuthContext>();

  useEffect(() => {
    return () => {
      if (intervalRef.current) {
        clearInterval(intervalRef.current);
      }

      if (timeoutRef.current) {
        clearTimeout(timeoutRef.current);
      }
    };
  }, []);

  const resetTimers = () => {
    if (intervalRef.current) {
      clearInterval(intervalRef.current);
      intervalRef.current = null;
    }

    if (timeoutRef.current) {
      clearTimeout(timeoutRef.current);
      timeoutRef.current = null;
    }
  };

  const finishUpload = useCallback(
    async (base64Data: string) => {
      try {
        const result = await onComplete?.(base64Data);

        if (result === false) {
          setFile(null);
          setProgress(0);
          setError(
            "Upload completed, but the next step failed. Please try again.",
          );
        }
      } catch {
        setFile(null);
        setProgress(0);
        setError(
          "Something went wrong while preparing your image. Please try again.",
        );
      } finally {
        timeoutRef.current = null;
      }
    },
    [onComplete],
  );

  const processFile = (selectedFile: File) => {
    setError(null);

    resetTimers();
    setFile(selectedFile);
    setProgress(0);

    const reader = new FileReader();

    reader.onload = () => {
      const base64Data = typeof reader.result === "string" ? reader.result : "";

      intervalRef.current = setInterval(() => {
        setProgress((currentProgress) => {
          const nextProgress = Math.min(
            100,
            currentProgress + PROGRESS_INCREMENT,
          );

          if (nextProgress === 100) {
            resetTimers();
            timeoutRef.current = setTimeout(() => {
              void finishUpload(base64Data);
            }, REDIRECT_DELAY_MS);
          }

          return nextProgress;
        });
      }, PROGRESS_INTERVAL_MS);
    };

    reader.readAsDataURL(selectedFile);
  };

  const ensureSignedIn = async () => {
    if (isSignedIn) return true;

    const signedIn = await signIn();
    return signedIn;
  };

  const isAllowedImage = (selectedFile: File) => {
    return ["image/jpeg", "image/png"].includes(selectedFile.type);
  };

  const handleFileChange = async (
    event: React.ChangeEvent<HTMLInputElement>,
  ) => {
    const selectedFile = event.target.files?.[0];

    if (!selectedFile) return;

    if (!isAllowedImage(selectedFile)) {
      setError("Please upload a JPG or PNG image.");
      event.currentTarget.value = "";
      return;
    }

    const signedIn = await ensureSignedIn();

    if (!signedIn) {
      setError("Please sign in before uploading.");
      event.currentTarget.value = "";
      return;
    }

    processFile(selectedFile);
  };

  const handleDragOver = (event: React.DragEvent<HTMLDivElement>) => {
    event.preventDefault();

    if (!isSignedIn) return;

    setIsDragging(true);
  };

  const handleDragLeave = (event: React.DragEvent<HTMLDivElement>) => {
    event.preventDefault();
    setIsDragging(false);
  };

  const handleDrop = (event: React.DragEvent<HTMLDivElement>) => {
    event.preventDefault();
    setIsDragging(false);

    if (!isSignedIn) {
      void (async () => {
        const signedIn = await ensureSignedIn();
        if (!signedIn) {
          setError("Please sign in before uploading.");
        }
      })();
      return;
    }

    const droppedFile = event.dataTransfer.files?.[0];

    if (!droppedFile) return;

    if (!isAllowedImage(droppedFile)) {
      setError("Please upload a JPG or PNG image.");
      return;
    }

    processFile(droppedFile);
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
            onChange={handleFileChange}
          />
          <div className="drop-content">
            <div className="drop-icon">
              <UploadIcon size={20} />
            </div>
            <p>
              {isSignedIn
                ? "Click to Upload or just drag and drop"
                : "Sign in or Sign up with Puterto Upload"}
            </p>
            <p className="help">Maximum file size 50MB</p>
            {error ? <p className="help">{error}</p> : null}
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
                {progress < 100 ? `Analyzing Floor Plan...` : `Redirecting...`}
              </p>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

export default Upload;
