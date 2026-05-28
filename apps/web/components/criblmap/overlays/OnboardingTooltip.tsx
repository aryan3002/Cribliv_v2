"use client";

import { useState, useEffect } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { X, Sparkles } from "lucide-react";

interface OnboardingStep {
  id: string;
  target: string; // CSS class of the element to highlight
  title: string;
  description: string;
  position: "top" | "bottom" | "left" | "right";
}

const STEPS: OnboardingStep[] = [
  {
    id: "search",
    target: ".cmap-topbar__search",
    title: "Search any area",
    description: "Type a locality or neighbourhood to jump directly to it on the map.",
    position: "bottom"
  },
  {
    id: "area-stats",
    target: ".cmap-toolbar__btn",
    title: "Draw to Analyze",
    description:
      "Tap the Stats tool, then draw a rectangle on the map to see average rents, BHK breakdown, and trends for that exact area.",
    position: "left"
  },
  {
    id: "metro",
    target: ".cmap-toolbar",
    title: "Toggle Metro Lines",
    description: "See Delhi NCR metro lines overlaid on the map. Tap any station dot for details.",
    position: "left"
  },
  {
    id: "benchmark",
    target: ".cmap-bottombar__link",
    title: "Is My Rent Fair?",
    description:
      "Free tool — enter your rent and get an instant comparison against verified listings in your area.",
    position: "top"
  }
];

const STORAGE_KEY = "criblmap_onboarding_seen";

export function OnboardingTooltip() {
  const [currentStep, setCurrentStep] = useState<number | null>(null);
  const [dismissed, setDismissed] = useState(true);

  useEffect(() => {
    // Check if user has already seen the onboarding
    try {
      const seen = localStorage.getItem(STORAGE_KEY);
      if (!seen) {
        // Delay showing to let the map load first
        const timer = setTimeout(() => {
          setDismissed(false);
          setCurrentStep(0);
        }, 2000);
        return () => clearTimeout(timer);
      }
    } catch {
      // localStorage not available
    }
  }, []);

  const handleNext = () => {
    if (currentStep === null) return;
    if (currentStep < STEPS.length - 1) {
      setCurrentStep(currentStep + 1);
    } else {
      handleDismiss();
    }
  };

  const handleDismiss = () => {
    setDismissed(true);
    setCurrentStep(null);
    try {
      localStorage.setItem(STORAGE_KEY, "1");
    } catch {
      // localStorage not available
    }
  };

  if (dismissed || currentStep === null) return null;

  const step = STEPS[currentStep];

  return (
    <AnimatePresence>
      <motion.div
        key={step.id}
        className={`cmap-onboarding cmap-onboarding--${step.position}`}
        initial={{ opacity: 0, scale: 0.9 }}
        animate={{ opacity: 1, scale: 1 }}
        exit={{ opacity: 0, scale: 0.9 }}
        transition={{ duration: 0.2 }}
      >
        <div className="cmap-onboarding__header">
          <Sparkles size={14} />
          <span className="cmap-onboarding__step">
            {currentStep + 1} / {STEPS.length}
          </span>
          <button
            className="cmap-onboarding__close"
            onClick={handleDismiss}
            aria-label="Dismiss onboarding"
          >
            <X size={14} />
          </button>
        </div>
        <h4 className="cmap-onboarding__title">{step.title}</h4>
        <p className="cmap-onboarding__desc">{step.description}</p>
        <div className="cmap-onboarding__actions">
          <button className="cmap-onboarding__skip" onClick={handleDismiss}>
            Skip
          </button>
          <button className="cmap-onboarding__next" onClick={handleNext}>
            {currentStep < STEPS.length - 1 ? "Next" : "Got it!"}
          </button>
        </div>
      </motion.div>
    </AnimatePresence>
  );
}
