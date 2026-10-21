import type { ComponentType, SVGProps } from "react";

import Biopsy from "~icons/healthicons/biopsy-outline-24px";
import Bladder from "~icons/healthicons/bladder-outline-24px";
import CellNuclei from "~icons/healthicons/cell-nuclei-outline-24px";
import ChartBar from "~icons/healthicons/chart-bar-outline-24px";
import ChartLine from "~icons/healthicons/chart-line-outline-24px";
import Dna from "~icons/healthicons/dna-outline-24px";
import Doctor from "~icons/healthicons/doctor-outline-24px";
import Eye from "~icons/healthicons/eye-outline-24px";
import Hospital from "~icons/healthicons/hospital-outline-24px";
import DocumentsAccepted from "~icons/healthicons/i-documents-accepted-outline-24px";
import DocumentsDenied from "~icons/healthicons/i-documents-denied-outline-24px";
import Info from "~icons/healthicons/info-outline-24px";
import IntegratedData from "~icons/healthicons/integrated-data-and-research-outline-24px";
import Kidneys from "~icons/healthicons/kidneys-outline-24px";
import Microscope from "~icons/healthicons/microscope-outline-24px";
import Prostate from "~icons/healthicons/prostate-outline-24px";
import Stethoscope from "~icons/healthicons/stethoscope-outline-24px";
import Tissue from "~icons/healthicons/tissue-outline-24px";
import UiMenu from "~icons/healthicons/ui-menu-outline";
import UiUserProfile from "~icons/healthicons/ui-user-profile-outline";
import ArrowLeft from "~icons/lucide/arrow-left";
import BookOpen from "~icons/lucide/book-open";
import Check from "~icons/lucide/check";
import CheckCheck from "~icons/lucide/check-check";
import ChevronDown from "~icons/lucide/chevron-down";
import ChevronsLeft from "~icons/lucide/chevrons-left";
import CircleAlert from "~icons/lucide/circle-alert";
import CircleCheck from "~icons/lucide/circle-check";
import ClipboardList from "~icons/lucide/clipboard-list";
import Clock from "~icons/lucide/clock";
import Download from "~icons/lucide/download";
import FileClock from "~icons/lucide/file-clock";
import FilePenLine from "~icons/lucide/file-pen-line";
import FileStack from "~icons/lucide/file-stack";
import Files from "~icons/lucide/files";
import FolderOpen from "~icons/lucide/folder-open";
import LogOut from "~icons/lucide/log-out";
import MapIcon from "~icons/lucide/map";
import Maximize from "~icons/lucide/maximize-2";
import Moon from "~icons/lucide/moon";
import Pencil from "~icons/lucide/pencil";
import Plus from "~icons/lucide/plus";
import ScrollText from "~icons/lucide/scroll-text";
import Sun from "~icons/lucide/sun";
import Upload from "~icons/lucide/upload";
import X from "~icons/lucide/x";

type Glyph = ComponentType<SVGProps<SVGSVGElement>>;

export const icons = {
  check: Check,
  doubleCheck: CheckCheck,
  clipboardList: ClipboardList,
  clock: Clock,
  fileClock: FileClock,
  review: FilePenLine,
  pencil: Pencil,
  download: Download,
  upload: Upload,

  arrowLeft: ArrowLeft,
  biopsy: Biopsy,
  bookOpen: BookOpen,
  bladder: Bladder,
  cellNuclei: CellNuclei,
  chartBar: ChartBar,
  chartLine: ChartLine,
  chevronDown: ChevronDown,
  chevrons: ChevronsLeft,
  circleAlert: CircleAlert,
  circleCheck: CircleCheck,
  close: X,
  data: IntegratedData,
  dna: Dna,
  doctor: Doctor,
  documents: Files,
  documentsAccepted: DocumentsAccepted,
  documentsDenied: DocumentsDenied,
  eye: Eye,
  fileStack: FileStack,
  folderOpen: FolderOpen,
  hospital: Hospital,
  info: Info,
  kidneys: Kidneys,
  logOut: LogOut,
  map: MapIcon,
  maximize: Maximize,
  menu: UiMenu,
  microscope: Microscope,
  moon: Moon,
  plus: Plus,
  prostate: Prostate,
  scrollText: ScrollText,
  stethoscope: Stethoscope,
  sun: Sun,
  tissue: Tissue,
  user: UiUserProfile,
} satisfies Record<string, Glyph>;

export type IconName = keyof typeof icons;
