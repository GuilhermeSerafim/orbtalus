import type { Metadata } from "next";
import Image from "next/image";
import {
  ArrowDown,
  ArrowUpRight,
  ArrowRight,
  Waves,
  Layers,
  ScanLine,
} from "lucide-react";
import { LandingNavigation } from "@/components/landing/navigation";
import {
  HeroFilm,
  Reveal,
  TerritoryExplorer,
} from "@/components/landing/experience";
import styles from "./page.module.css";

const title = "OrbTalus | Um novo olhar sobre o território";
const description =
  "Contexto territorial para equipes de água e esgoto. Conheça o protótipo OrbTalus e seu fluxo de avaliação inicial de exposição a inundações.";
export const metadata: Metadata = {
  title: { absolute: title },
  description,
  openGraph: {
    title,
    description,
    type: "website",
    locale: "pt_BR",
    images: ["/media/river-poster.jpg"],
  },
  twitter: {
    card: "summary_large_image",
    title,
    description,
    images: ["/media/river-poster.jpg"],
  },
};
const steps = [
  {
    icon: ScanLine,
    title: "Localize",
    text: "Uma localização representativa é o ponto de partida para conhecer a instalação e seu entorno.",
  },
  {
    icon: Layers,
    title: "Conecte",
    text: "Relevo, hidrografia, cobertura e presença histórica de água compõem a leitura territorial.",
  },
  {
    icon: Waves,
    title: "Interprete",
    text: "Um indicador por regras e uma explicação assistida por IA ajudam a organizar a avaliação inicial.",
  },
  {
    icon: ArrowUpRight,
    title: "Investigue",
    text: "Sua equipe revisa as evidências e decide o próximo passo: vistoria, estudo ou investigação complementar.",
  },
];
export default function HomePage() {
  return (
    <div className={styles.page} id="inicio">
      <a className={styles.skipLink} href="#conteudo">
        Pular para o conteúdo
      </a>
      <section className={styles.hero} aria-labelledby="hero-title">
        <HeroFilm />
        <header className={`${styles.container} ${styles.header}`}>
          <a
            className={styles.brand}
            href="#inicio"
            aria-label="OrbTalus — início"
          >
            <Image
              src="/orbtalus-simbolo-branco-teal-v1.svg"
              alt=""
              width={64}
              height={64}
              priority
            />
            <span>
              OrbTalus<small>INTELIGÊNCIA TERRITORIAL</small>
            </span>
          </a>
          <LandingNavigation />
        </header>
        <div className={`${styles.container} ${styles.heroContent}`}>
          <p className={styles.eyebrow}>
            <span /> ÁGUA, TERRITÓRIO E INFRAESTRUTURA
          </p>
          <h1 id="hero-title">
            O risco tem contexto.
            <br />
            <span>Enxergue além.</span>
          </h1>
          <p className={styles.heroDescription}>
            Um novo olhar sobre o entorno da sua instalação.
            <br className={styles.desktopBreak} /> Mais contexto para preparar a
            próxima investigação.
          </p>
          <div className={styles.actions}>
            <a className={styles.primaryLink} href="/analise">
              Explore o território <ArrowUpRight size={20} />
            </a>
            <a className={styles.textLink} href="#conversa">
              Vamos conversar <ArrowRight size={18} />
            </a>
          </div>
        </div>
        <div className={`${styles.container} ${styles.heroBottom}`}>
          <span>PARA EQUIPES DE ÁGUA E ESGOTO</span>
          <a href="#conteudo">
            Conheça a proposta <ArrowDown size={18} />
          </a>
        </div>
      </section>
      <main id="conteudo" tabIndex={-1}>
        <section className={`${styles.container} ${styles.intro}`}>
          <Reveal>
            <p className={styles.sectionLabel}>01 — AMPLIE A PERSPECTIVA</p>
          </Reveal>
          <Reveal>
            <h2>
              Uma instalação nunca
              <br />
              existe <em>isolada.</em>
            </h2>
            <p className={styles.lead}>
              O rio ao lado. A forma do relevo. O que cobre o solo. Cada
              elemento muda as perguntas que sua equipe precisa fazer.
            </p>
            <p className={styles.bodyCopy}>
              O OrbTalus está sendo desenvolvido para reunir esse contexto e
              apoiar a avaliação inicial de exposição a inundações. Um ponto de
              partida para investigar, em diálogo com o GIS, os estudos e a
              experiência de campo da sua equipe.
            </p>
          </Reveal>
        </section>
        <section
          className={styles.exploreSection}
          id="exemplo"
          tabIndex={-1}
          aria-labelledby="explore-title"
        >
          <div className={styles.container}>
            <Reveal className={styles.sectionHeading}>
              <div>
                <p className={styles.sectionLabel}>02 — LEIA AS CAMADAS</p>
                <h2 id="explore-title">
                  O mesmo lugar.
                  <br />
                  <em>Novas perspectivas.</em>
                </h2>
              </div>
              <p>
                Explore quatro fatores que ajudam a compreender o entorno.
                Selecione uma camada para conhecer seu papel.
              </p>
            </Reveal>
            <TerritoryExplorer />
          </div>
        </section>
        <section
          className={`${styles.container} ${styles.workflow}`}
          id="como-funciona"
          tabIndex={-1}
          aria-labelledby="flow-title"
        >
          <Reveal className={styles.sectionHeading}>
            <div>
              <p className={styles.sectionLabel}>
                03 — DO CONTEXTO À INVESTIGAÇÃO
              </p>
              <h2 id="flow-title">
                Dados conectados.
                <br />
                Decisões <em>com critério.</em>
              </h2>
            </div>
            <p>
              Um fluxo proposto para o protótipo.
              <br />A revisão técnica permanece com sua equipe.
            </p>
          </Reveal>
          <ol className={styles.steps}>
            {steps.map((step, index) => (
              <li key={step.title}>
                <Reveal>
                  <div className={styles.stepTop}>
                    <span>0{index + 1}</span>
                    <step.icon size={25} strokeWidth={1.2} />
                  </div>
                  <h3>{step.title}</h3>
                  <p>{step.text}</p>
                </Reveal>
              </li>
            ))}
          </ol>
        </section>
        <section
          className={styles.principles}
          aria-labelledby="principles-title"
        >
          <div className={`${styles.container} ${styles.principlesGrid}`}>
            <Reveal>
              <p className={styles.sectionLabel}>CLAREZA TAMBÉM É TECNOLOGIA</p>
              <h2 id="principles-title">
                Uma leitura inicial.
                <br />
                Com limites <em>visíveis.</em>
              </h2>
              <p>
                Para usar um indicador com responsabilidade, é preciso entender
                o que está por trás dele.
              </p>
            </Reveal>
            <div className={styles.principleList}>
              <Reveal>
                <span>01</span>
                <div>
                  <h3>O ponto e o entorno</h3>
                  <p>
                    A leitura parte de uma localização representativa. Ela não
                    equivale a avaliar toda a área do imóvel.
                  </p>
                </div>
              </Reveal>
              <Reveal>
                <span>02</span>
                <div>
                  <h3>Indicador com contexto</h3>
                  <p>
                    A nota por regras é preliminar. Não é uma probabilidade
                    calibrada de inundação nem um laudo conclusivo.
                  </p>
                </div>
              </Reveal>
              <Reveal>
                <span>03</span>
                <div>
                  <h3>IA com revisão humana</h3>
                  <p>
                    A explicação assistida apoia a interpretação. Qualidade dos
                    dados, limitações e coerência precisam ser examinadas pela
                    equipe.
                  </p>
                </div>
              </Reveal>
            </div>
          </div>
        </section>
        <section
          className={`${styles.container} ${styles.conversation}`}
          id="conversa"
          tabIndex={-1}
          aria-labelledby="contact-title"
        >
          <Reveal>
            <p className={styles.sectionLabel}>VAMOS CONSTRUIR ESSA CONVERSA</p>
            <h2 id="contact-title">
              Qual é a próxima pergunta
              <br />
              sobre o <em>seu território?</em>
            </h2>
            <p>
              Queremos entender como sua equipe prepara uma avaliação e onde o
              contexto territorial pode ajudar.
            </p>
          </Reveal>
          <Reveal className={styles.contactCard}>
            <span className={styles.contactIcon}>
              <ArrowUpRight size={30} strokeWidth={1} />
            </span>
            <h3>Comece pela tarefa.</h3>
            <p>Sua organização. Sua decisão. Seu processo atual.</p>
            <p className={styles.contactNote}>
              Escreva para conversar sobre sua organização e o contexto do seu
              território. Não é necessário compartilhar dados sensíveis nessa
              conversa inicial.
            </p>
            <a
              className={styles.contactLink}
              href="mailto:guilerstudies@gmail.com"
            >
              guilerstudies@gmail.com <ArrowUpRight size={18} aria-hidden="true" />
            </a>
          </Reveal>
        </section>
      </main>
      <footer className={styles.footer}>
        <div className={styles.container}>
          <a href="#inicio" className={styles.footerBrand}>
            OrbTalus <ArrowUpRight size={22} />
          </a>
          <span>Território. Contexto. Investigação.</span>
          <a href="#inicio">
            Voltar ao topo <ArrowUpRight size={16} />
          </a>
        </div>
        <div className={`${styles.container} ${styles.footerFine}`}>
          <span>© {new Date().getFullYear()} Equipe OrbTalus</span>
        </div>
      </footer>
    </div>
  );
}
