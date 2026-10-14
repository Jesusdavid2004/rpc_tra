import i18n from "i18next";
import { initReactI18next } from "react-i18next";

const resources = {
  es: {
    translation: {
      title: "RemateYa",
      subtitle: "Subasta en vivo con gRPC (Connect + Protobuf)",
      language: "Idioma",
      login: {
        title: "Ingresar",
        name: "Tu nombre",
        role: "Rol",
        bidder: "Postor",
        auctioneer: "Rematador",
        pin: "PIN del rematador",
        submit: "Entrar",
        logout: "Salir",
        signedInAs: "Sesión: {{name}} ({{role}})",
      },
      auction: {
        idLabel: "ID de la subasta",
        create: "Crear subasta",
        join: "Unirse / Observar",
        name: "Nombre de la subasta",
        current: "Subasta: {{name}}",
      },
      lot: {
        none: "No hay lote activo",
        animalType: "Tipo",
        breed: "Raza",
        weight: "Peso (kg)",
        age: "Edad (meses)",
        basePrice: "Precio base",
        increment: "Incremento mínimo",
        duration: "Duración (s)",
        open: "Abrir lote",
        close: "Cerrar lote",
        highest: "Puja más alta",
        noBids: "Sin pujas",
        timeLeft: "Tiempo restante (reloj del servidor)",
        closed: "Lotes cerrados",
        winner: "Ganador: {{winner}} por {{price}}",
        noWinner: "Sin ganador",
      },
      bid: {
        amount: "Tu puja",
        submit: "Pujar",
        minimum: "Mínimo: {{amount}}",
      },
      history: {
        title: "Historial en vivo",
        lotOpened: "Lote abierto: {{animal}} {{breed}}",
        accepted: "{{bidder}} pujó {{amount}}",
        rejected: "Puja rechazada de {{bidder}} ({{amount}}): {{reason}}",
        extended: "Tiempo extendido (anti-sniping)",
        closed: "Lote cerrado",
      },
      connection: {
        connecting: "Conectando…",
        live: "En vivo",
        reconnecting: "Reconectando…",
      },
      errors: { generic: "Error: {{message}}" },
    },
  },
  en: {
    translation: {
      title: "RemateYa",
      subtitle: "Live auction over gRPC (Connect + Protobuf)",
      language: "Language",
      login: {
        title: "Sign in",
        name: "Your name",
        role: "Role",
        bidder: "Bidder",
        auctioneer: "Auctioneer",
        pin: "Auctioneer PIN",
        submit: "Enter",
        logout: "Sign out",
        signedInAs: "Signed in: {{name}} ({{role}})",
      },
      auction: {
        idLabel: "Auction ID",
        create: "Create auction",
        join: "Join / Watch",
        name: "Auction name",
        current: "Auction: {{name}}",
      },
      lot: {
        none: "No active lot",
        animalType: "Type",
        breed: "Breed",
        weight: "Weight (kg)",
        age: "Age (months)",
        basePrice: "Base price",
        increment: "Minimum increment",
        duration: "Duration (s)",
        open: "Open lot",
        close: "Close lot",
        highest: "Highest bid",
        noBids: "No bids yet",
        timeLeft: "Time left (server clock)",
        closed: "Closed lots",
        winner: "Winner: {{winner}} for {{price}}",
        noWinner: "No winner",
      },
      bid: {
        amount: "Your bid",
        submit: "Bid",
        minimum: "Minimum: {{amount}}",
      },
      history: {
        title: "Live history",
        lotOpened: "Lot opened: {{animal}} {{breed}}",
        accepted: "{{bidder}} bid {{amount}}",
        rejected: "Rejected bid from {{bidder}} ({{amount}}): {{reason}}",
        extended: "Time extended (anti-sniping)",
        closed: "Lot closed",
      },
      connection: {
        connecting: "Connecting…",
        live: "Live",
        reconnecting: "Reconnecting…",
      },
      errors: { generic: "Error: {{message}}" },
    },
  },
};

if (!i18n.isInitialized) {
  void i18n.use(initReactI18next).init({
    resources,
    lng: "es",
    fallbackLng: "en",
    interpolation: { escapeValue: false },
  });
}

export default i18n;
