"use client";

import { useEffect, useCallback, type ReactNode } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { X } from "lucide-react";
import { useMapState, useMapDispatch } from "../hooks/useMapState";

interface SidePanelProps {
  title?: string;
  children: ReactNode;
}

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

  return (
    <AnimatePresence>
      {isOpen && (
        <motion.div
          className="cmap-panel"
          initial={{ x: "100%" }}
          animate={{ x: 0 }}
          exit={{ x: "100%" }}
          transition={{ type: "spring", damping: 30, stiffness: 300 }}
        >
          <div className="cmap-panel__drag-handle" style={{ display: "none" }} />
          <div className="cmap-panel__header">
            <span className="cmap-panel__title">{title ?? "Details"}</span>
            <button className="cmap-panel__close" onClick={handleClose} aria-label="Close panel">
              <X size={16} />
            </button>
          </div>
          <div className="cmap-panel__body">{children}</div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}
