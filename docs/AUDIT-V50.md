# AUDIT V50 — Flipnote Converter (V49)

## 1. SISTEMA DE ESTADOS

- **Variable principal:** `activeTab` (L2413), inicializada como `'cam'`
- **Función central:** `switchTab(tab)` (L2415-2472)
- **Valores válidos:** `'cam'`, `'up'`, `'ascii'`, `'sono'`, `'wmp'`, `'scrash'`
- **Tabs HTML:** `#tabCam`, `#tabUp`, `#tabAscii`, `#tabSono`, `#tabWmp`, `#tabScrash`

### Variables de estado adicionales
```
asciiPanelOpen = false     // L1453 — panel edit ASCII
wmpPseudoFull  = false     // L1455 — fullscreen WMP
cameraRunning  = false     // L2297
asciiRunning   = false     // L2297
uploadProcessing = false   // L2759
sonoRunning    = false     // L3289
wmpRunning     = false     // L4137
scrashRunning  = false     // L5249
```

---

## 2. BLOQUES DOM POR MODO

| Modo | Área principal | Bottom bar | HUD/Panel edit | Body class |
|------|---------------|------------|----------------|------------|
| cam | `#display` (style.display=block) | `#barCam` (style.display='') | — | — |
| up | `#uploadSection` (.visible) | `#barUpload` (.visible) | `#upPanel` (body.up-edit-open) | `body.up-edit-open` |
| ascii | `#asciiArea` (.visible) | `#barAscii` (.visible) | `#asciiPanel` (body.ascii-edit) | `body.ascii-mode`, `body.ascii-edit` |
| sono | `#sonoArea` (.visible) | `#barSono` (.visible) | `#sonoHUD` (.visible) | `body.sono-mode` |
| wmp | `#wmpArea` (.visible) | `#barWmp` (.visible) | `#wmpHUD` (.visible) | — |
| scrash | `#scrashArea` (.visible) | `#barScrash` (.visible) | `#scrashControls` (.visible) | `body.scrash-hud-open` |

**Nota:** SCRASH controls se muestran también cuando `isUp && uploadMode === 'scrash'`

---

## 3. CONTROLES DUPLICADOS

### Sliders de imagen (Brightness, Contrast, Saturation, Hue, Grayscale, Sepia, Invert)
Aparecen en **3 lugares** del DOM:

| Slider | ASCII Panel | Upload Flip | Upload ASCII |
|--------|-------------|-------------|--------------|
| Brightness | `#acBright` → `#vBright` (L776) | `#upAcBright` → `#upVBright` (L946) | `#upAcBrightA` → `#upVBrightA` (L976) |
| Contrast | `#acContrast` → `#vContrast` (L781) | `#upAcContrast` → `#upVContrast` (L947) | `#upAcContrastA` → `#upVContrastA` (L977) |
| Saturation | `#acSat` → `#vSat` (L786) | `#upAcSat` → `#upVSat` (L948) | `#upAcSatA` → `#upVSatA` (L978) |
| Hue | `#acHue` → `#vHue` (L791) | `#upAcHue` → `#upVHue` (L949) | `#upAcHueA` → `#upVHueA` (L979) |
| Grayscale | `#acGray` → `#vGray` (L796) | — | `#upAcGrayA` → `#upVGrayA` (L980) |
| Sepia | `#acSepia` → `#vSepia` (L801) | — | `#upAcSepiaA` → `#upVSepiaA` (L981) |
| Invert | `#acInvert` → `#vInvert` (L806) | — | `#upAcInvertA` → `#upVInvertA` (L982) |

**⚠ CONFLICTO DE ESTADO:** Todos actualizan las mismas variables globales (`acBrightVal`, etc.).
Los sliders de Upload usan `bindSlider()` en L3009 y L3032 respectivamente.

---

## 4. BOTTOM BARS

### `#barCam` (L1038-1050)
- Visibilidad: `style.display = isCam ? '' : 'none'`
- Botones: `#btnRecord` (FOTO/VIDEO toggle) | `#btnCapture` (●) | `#btnShare` (↑)

### `#barUpload` (L1074-1091)
- Visibilidad: `classList.toggle('visible', isUp)`
- Botones: `#btnChoose` (📂) | `#btnSaveResult` (💾) | `#btnShareResult` (↑) | `#btnUpEdit` (⚙ EDIT)

### `#barAscii` (L1052-1072)
- Visibilidad: `classList.toggle('visible', isAscii)`
- Botones: `#btnAsciiMode` (📷/🎥) | `#btnAsciiCapture` (●) | `#btnAsciiShare` (↑) | `#btnAsciiGlitch` (⚡) | `#btnAsciiEdit` (⚙)

### `#barSono` (L1130-1151)
- Visibilidad: `classList.toggle('visible', isSono)`
- Botones: `#btnSonoRec` (⏺ REC) | `#btnSonoCapture` (●) | `#btnSonoFile` (📂) | `#btnSonoShare` (↑) | `#btnSonoReset` (↺)

### `#barWmp` (L1193-1210)
- Visibilidad: `classList.toggle('visible', isWmp)`
- Botones: `#btnWmpMicBar` (🎙 MIC) | `#btnWmpPlayPause` (▶) | `#btnWmpFileBar` (📂 FILE) | `#btnWmpFull` (⛶ FULL)

### `#barScrash` (L1213-1225)
- Visibilidad: `classList.toggle('visible', isScrash)`
- Botones: `#btnScrashSnap` (● SNAP) | `#btnScrashShare` (↑) | `#btnScrashReset` (✕ RESET)

---

## 5. FUNCIONES DE EXPORTACIÓN

- **`_download(blob, filename)`** (L2492-2495) — descarga directa
- **`_shareOrDownload(blob, filename)`** (L2498-2505) — intenta native share API, fallback a `_download()`

| Modo | Acción | Código |
|------|--------|--------|
| cam | Foto capture | inline en `btnCapture` click (L2550) |
| cam | Share | inline en `btnShare` click (L2584) |
| ascii | Capture | inline en `btnAsciiCapture` click (L2888) |
| ascii | Share | inline en `btnAsciiShare` click (L2925) |
| ascii | PNG button | `#acPng` click (L3226) |
| ascii | TXT button | `#acTxt` click (L3223) |
| ascii | Copy | `#acCopy` click (L3210) |
| upload | Save/Share | `btnSaveResult.onclick = () => _shareOrDownload(...)` (L2652) |
| sono | Capture | inline (L4051) |
| scrash | Snap | inline en `#btnScrashSnap` click (L5339) |

---

## 6. WARNINGS EXISTENTES

| Elemento | Tipo | Activación | Ubicación DOM |
|---------|------|-----------|---------------|
| `#thermalToast` | DOM fijo, toggle | `_thermalShowThermalToast()` debounce | L857/1257 |
| `#asciiPerfWarn` | DOM fijo, `style.display` | ASCII loop L2355/2368 | L727-729, dentro `#asciiPanel` |
| `#androidRow` | DOM fijo condicional | Init (detección mobile) | L731-734, dentro `#asciiPanel` |
| Alerts nativos | `alert()` | On error (grabación, archivo grande) | L2562, 2762, 4000 |
| `#feedbackWarn` | DOM fijo | mic mode | L1279 |

---

## 7. CONTROLES POR MODO

### CAM — exclusivos
- `#display` canvas, `#btnFlip`, `#camFpsCtrl`, `#camAspect`, `#barCam`
- Sin sliders de imagen propios (solo imagen en vivo)

### UPLOAD — exclusivos por subtipo
- Flip: `#upFlipTabs`, `#upFlipImage` (bright/contrast/sat/hue/exposure/shadows/highlights), `#upFlipEffects` (threshold/dither/grain/gray/sepia/invert/vignette)
- ASCII: `#upAsciiSection` (chars + todos los sliders de imagen + effects)
- Scrash: reutiliza `#scrashControls`
- Compartido: `#uploadSection`, `#barUpload`, `#upPanel`, `#upAcMix`

### ASCII — exclusivos
`#asciiArea`, `#asciiPanel` con: chars, space density, quality, frame, bright/contrast/sat/hue/gray/sepia/invert, threshold, sharpness, edge detect, font, gradient, pythonization (modo/paleta/chaos), botones COPY/TXT/PNG/RESET

### SONO — exclusivos
`#sonoArea`, `#sonoHUD` (preset tabs, blend target, mix, chaos, hue), `#barSono`, `#sonoProgress`

### WMP — exclusivos
`#wmpArea`, `#wmpHUD` (presets, sens, trails), `#barWmp`, `#wmpProgress`, `#wmpPerm`

### SCRASH — exclusivos
`#scrashArea`, `#scrashControls` (paleta, aspect ratio, 8 sliders: chroma/drip/neon/wave/crush/hue/grain/chaos, animate+speed), `#barScrash`

---

## PROBLEMAS IDENTIFICADOS PARA V50

1. **Sliders duplicados con conflicto de estado** — mismas variables globales actualizadas desde 3 UIs distintas
2. **6 bottom bars independientes** — mismo patrón, implementación distinta en cada una
3. **Panel management heterogéneo** — `body.ascii-edit` vs `style.display` vs `.visible` class
4. **~45 controles simultáneos** en ASCII — necesita progressive disclosure urgente
5. **Warnings ad-hoc** — `#thermalToast` y `#asciiPerfWarn` con mecanismos distintos
6. **Upload tiene 3 submodos** no reflejados en el sistema de tabs principal
