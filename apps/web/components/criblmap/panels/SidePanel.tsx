"use client";

import { useEffect, useCallback, type ReactNode } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { X } from "lucide-react";
import { useMapState, useMapDispatch } from "../hooks/useMapState";

interface SidePanelProps {
  title?: string;
  children: ReactNode;
}

/**
 * Responsive side panel — slides from right on desktop, bottom sheet on mobile.
 * Breakpoint: 768px matches all other CriblMap responsive rules.
 */
export function SidePanel({ title, children }: SidePanelProps) {
  const { panelContent, drawMode } = useMapState();
  const dispatch = useMapDispatch();
  const isOpen = panelContent.type !== "none";

  const handleClose = useCallback(() => {
    if (panelContent.type === "area-stats") {
      dispatch({ type: "CLEAR_DRAW" });
    } else {
      dispatch({ type: "DESELECT_PIN" });
    }
  }, [dispatch, panelContent.type]);

  useEffect(() => {
    function handleKeyDown(e: KeyboardEvent) {
      if (e.key === "Escape" && isOpen) handleClose();
    }
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [isOpen, handleClose]);

  // Detect if we should render as bottom sheet
  const isMobile = typeof window !== "undefined" && window.matchMedia("(max-width: 768px)").matches;

  // Desktop: slide from right. Mobile: slide from bottom.
  const variants = isMobile
    ? {
        initial: { y: "100%" },
        animate: { y: 0 },
        exit: { y: "100%" }
      }
    : {
        initial: { x: "100%" },
        animate: { x: 0 },
        exit: { x: "100%" }
      };

  return (
    <AnimatePresence>
      {isOpen && (
        <>
          {/* Mobile backdrop (only on mobile) */}
          {isMobile && (
            <motion.div
              className="cmap-panel-mobile-backdrop"
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              onClick={handleClose}
            />
          )}
          <motion.div
            className={`cmap-panel${isMobile ? " cmap-panel--mobile" : ""}`}
            initial={variants.initial}
            animate={variants.animate}
            exit={variants.exit}
            transition={{ type: "spring", damping: 30, stiffness: 300 }}
          >
            {/* Drag handle for mobile */}
            {isMobile && <div className="cmap-panel__drag-handle" />}
            {!isMobile && <div className="cmap-panel__drag-handle" style={{ display: "none" }} />}
            <div className="cmap-panel__header">
              <span className="cmap-panel__title">{title ?? "Details"}</span>
              <button className="cmap-panel__close" onClick={handleClose} aria-label="Close panel">
                <X size={16} />
              </button>
            </div>
            <div className="cmap-panel__body">{children}</div>
          </motion.div>
        </>
      )}
    </AnimatePresence>
  );
}
