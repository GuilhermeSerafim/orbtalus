"use client";
import { useEffect, useRef, useState, type ReactNode } from "react";
import { motion, useReducedMotion } from "motion/react";
import { Mountain, Waves, Layers, History, Plus } from "lucide-react";
import styles from "@/app/page.module.css";

export function Reveal({
  children,
  className,
}: {
  children: ReactNode;
  className?: string;
}) {
  const reduced = useReducedMotion();
  return (
    <motion.div
      className={className}
      initial={false}
      whileInView={reduced ? undefined : { opacity: [0.65, 1], y: [14, 0] }}
      viewport={{ once: true, amount: 0.12 }}
      transition={{ duration: 0.55, ease: "easeOut" }}
    >
      {children}
    </motion.div>
  );
}
export function HeroFilm() {
  const ref = useRef<HTMLVideoElement>(null);
  useEffect(() => {
    const video = ref.current!;
    const media = matchMedia("(prefers-reduced-motion: reduce)");
    const connection = (
      navigator as Navigator & { connection?: { saveData?: boolean } }
    ).connection;
    let visible = true;
    const sync = () => {
      if (
        media.matches ||
        connection?.saveData ||
        document.hidden ||
        !visible
      )
        video.pause();
      else {
        if (!video.getAttribute("src")) video.src = "/media/river-context.mp4";
        void video.play().catch(() => {});
      }
    };
    const observer = new IntersectionObserver(([entry]) => {
      visible = entry.isIntersecting;
      sync();
    });
    observer.observe(video);
    media.addEventListener("change", sync);
    document.addEventListener("visibilitychange", sync);
    sync();
    return () => {
      observer.disconnect();
      media.removeEventListener("change", sync);
      document.removeEventListener("visibilitychange", sync);
      video.pause();
    };
  }, []);
  return (
    <div className={styles.film} aria-hidden="true">
      <video
        ref={ref}
        poster="/media/river-poster.jpg"
        preload="none"
        muted
        loop
        playsInline
      />
      <div className={styles.filmShade} />
    </div>
  );
}
const layers = [
  {
    title: "Relevo",
    icon: Mountain,
    label: "A forma do terreno",
    text: "Diferenças de altitude ajudam a situar uma instalação em relação aos corpos d’água próximos.",
    note: "O relevo local exige interpretação e verificação em campo.",
  },
  {
    title: "Hidrografia",
    icon: Waves,
    label: "A relação com a água",
    text: "A distância e a posição dos cursos d’água oferecem contexto para examinar a exposição da instalação.",
    note: "A presença de um rio não determina, sozinha, o risco.",
  },
  {
    title: "Cobertura",
    icon: Layers,
    label: "O que ocupa o entorno",
    text: "Áreas vegetadas e urbanizadas ajudam a descrever a ocupação do território e a formular perguntas sobre o solo.",
    note: "Cobertura do solo não equivale a uma medição de permeabilidade.",
  },
  {
    title: "Histórico da água",
    icon: History,
    label: "Uma perspectiva no tempo",
    text: "Registros de presença de água acrescentam uma camada temporal à leitura do entorno.",
    note: "Presença de água no entorno não comprova inundação no imóvel.",
  },
];
export function TerritoryExplorer() {
  const [active, setActive] = useState(0);
  const buttons = useRef<(HTMLButtonElement | null)[]>([]);
  const selected = layers[active];
  return (
    <div className={styles.explorer}>
      <div
        className={styles.layerControls}
        role="tablist"
        aria-label="Camadas do território"
        onKeyDown={(e) => {
          let next = active;
          if (e.key === "ArrowRight") next = (active + 1) % 4;
          else if (e.key === "ArrowLeft") next = (active + 3) % 4;
          else if (e.key === "Home") next = 0;
          else if (e.key === "End") next = 3;
          else return;
          e.preventDefault();
          setActive(next);
          buttons.current[next]?.focus();
        }}
      >
        {layers.map((layer, i) => (
          <button
            key={layer.title}
            ref={(el) => {
              buttons.current[i] = el;
            }}
            role="tab"
            id={`layer-${i}`}
            aria-selected={active === i}
            aria-controls="territory-panel"
            tabIndex={active === i ? 0 : -1}
            onClick={() => setActive(i)}
          >
            <layer.icon size={18} strokeWidth={1.4} />
            {layer.title}
            <span>0{i + 1}</span>
          </button>
        ))}
      </div>
      <div
        className={styles.explorerBody}
        role="tabpanel"
        id="territory-panel"
        aria-labelledby={`layer-${active}`}
        tabIndex={0}
      >
        <div className={styles.mapScene} data-layer={active}>
          <div className={styles.mapHeading}>
            <span>ESTUDO DE CONTEXTO</span>
            <span>SEM ESCALA</span>
          </div>
          <svg
            viewBox="0 0 800 480"
            role="img"
            aria-label={`Ilustração conceitual de uma instalação: camada ${selected.title}. Não representa uma análise real.`}
          >
            <defs>
              <pattern
                id="grid-lp"
                width="40"
                height="40"
                patternUnits="userSpaceOnUse"
              >
                <path
                  d="M40 0H0V40"
                  fill="none"
                  stroke="#b7cbbf"
                  strokeOpacity=".35"
                />
              </pattern>
            </defs>
            <path d="M0 0h800v480H0z" fill="#e5e9df" />
            <path d="M0 0h800v480H0z" fill="url(#grid-lp)" />
            <g
              className={styles.contours}
              fill="none"
              stroke="#819684"
              strokeWidth="1.4"
            >
              {Array.from({ length: 13 }, (_, i) => (
                <path
                  key={i}
                  d={`M${-100 + i * 19} -10 C${160 + i * 16} 80, ${-60 + i * 21} 210, ${130 + i * 19} 280 S${240 + i * 20} 430, ${150 + i * 27} 510`}
                />
              ))}
              {Array.from({ length: 8 }, (_, i) => (
                <path
                  key={`b${i}`}
                  d={`M${540 + i * 28} -20 Q${420 + i * 28} 130 ${600 + i * 22} 210 T${610 + i * 25} 500`}
                />
              ))}
            </g>
            <g className={styles.coverage} fill="#9fb391">
              <path d="m500 20 162 15 85 90-35 86-142-36-82-70Z" />
              <path d="m25 315 95-8 96 102-80 82H0Z" />
              <path d="m530 330 190-40 100 90v110H589Z" />
            </g>
            <path
              className={styles.waterHistory}
              d="M284-30C400 70 270 150 384 253S541 320 580 510"
              fill="none"
              stroke="#79b8b0"
              strokeWidth="100"
              strokeOpacity=".25"
            />
            <path
              className={styles.river}
              d="M284-30C400 70 270 150 384 253S541 320 580 510"
              fill="none"
              stroke="#579d9b"
              strokeWidth="27"
            />
            <path
              d="M284-30C400 70 270 150 384 253S541 320 580 510"
              fill="none"
              stroke="#cbe3dc"
              strokeWidth="2"
            />
            <path
              d="M820 267 628 280 520 220 441 235"
              fill="none"
              stroke="#f7f7ef"
              strokeWidth="13"
            />
            <path
              d="M820 267 628 280 520 220 441 235"
              fill="none"
              stroke="#7e8d80"
              strokeWidth="1"
              strokeDasharray="6 5"
            />
            <circle
              cx="443"
              cy="234"
              r="75"
              fill="#d5e5cf"
              fillOpacity=".2"
              stroke="#235e59"
              strokeDasharray="4 7"
            />
            <g stroke="#204943" strokeWidth="1.5">
              <path d="m420 224 31-16 33 18-32 18Z" fill="#f6f8ed" />
              <path d="m420 224 32 20v25l-32-20Z" fill="#619183" />
              <path d="m452 244 32-18v25l-32 18Z" fill="#274f49" />
            </g>
            <circle
              cx="443"
              cy="234"
              r="6"
              fill="#e0ff97"
              stroke="#204943"
              strokeWidth="2"
            />
            <path d="m450 192 40-40h96" fill="none" stroke="#204943" />
            <rect
              x="488"
              y="127"
              width="145"
              height="28"
              rx="2"
              fill="#173c37"
            />
            <text
              x="499"
              y="146"
              fill="#eef4e9"
              fontSize="11"
              fontFamily="monospace"
            >
              INSTALAÇÃO EXEMPLO
            </text>
          </svg>
          <div className={styles.mapFooter}>
            <span>
              <Plus size={14} /> VISUALIZAÇÃO CONCEITUAL
            </span>
            <span>01 / 01</span>
          </div>
        </div>
        <div className={styles.layerDescription}>
          <span className={styles.layerNumber}>
            0{active + 1}
            <span> / 04</span>
          </span>
          <h3>{selected.label}</h3>
          <p>{selected.text}</p>
          <div className={styles.layerNote}>{selected.note}</div>
        </div>
      </div>
    </div>
  );
}
