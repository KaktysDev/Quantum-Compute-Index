"use client";

import { AnimatePresence, motion, type Variants } from "framer-motion";
import { useEffect, useState } from "react";

const PHASES = [
  { text: "QCI", size: "text-8xl sm:text-9xl" },
  { text: "Quantum Compute Index", size: "text-6xl sm:text-7xl" },
];

const container: Variants = {
  hidden: {},
  show: { transition: { staggerChildren: 0.04 } },
  exit: { transition: { staggerChildren: 0.015, staggerDirection: -1 } },
};

const letter: Variants = {
  hidden: { opacity: 0, y: 16, filter: "blur(10px)" },
  show: { opacity: 1, y: 0, filter: "blur(0px)", transition: { duration: 0.5, ease: "easeOut" } },
  exit: { opacity: 0, y: -14, filter: "blur(10px)", transition: { duration: 0.3 } },
};

export default function AnimatedTitle() {
  const [i, setI] = useState(0);

  useEffect(() => {
    const id = setInterval(() => setI((v) => (v + 1) % PHASES.length), 3800);
    return () => clearInterval(id);
  }, []);

  const phase = PHASES[i];

  return (
    <div className="relative flex min-h-[7.5rem] items-start sm:min-h-[10rem]">
      <AnimatePresence mode="wait">
        <motion.h1
          key={i}
          variants={container}
          initial="hidden"
          animate="show"
          exit="exit"
          className={`text-glow-strong font-semibold leading-[0.92] tracking-tight text-white ${phase.size}`}
          aria-label={phase.text}
        >
          {phase.text.split("").map((ch, idx) =>
            ch === " " ? (
              <span key={idx} style={{ display: "inline-block", width: "0.28em" }} />
            ) : (
              <motion.span key={idx} variants={letter} className="inline-block">
                {ch}
              </motion.span>
            ),
          )}
        </motion.h1>
      </AnimatePresence>
    </div>
  );
}
