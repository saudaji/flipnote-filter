# Debug Program — CAM System Evolution v1 Post-Check

## Bug Description
Verificación sistemática de todos los cambios introducidos en la sesión de evolución.
No hay un bug específico reportado — este es un chequeo proactivo.

## Evaluation Command
```bash
python3 .autodebug/eval.py
```

## Metric
- PRIMARY: 0 errores críticos (referencias rotas, ReferenceErrors, DOM IDs faltantes)
- SECONDARY: 0 errores medios (state sync issues, CSS conflicts)
- TERTIARY: bugs menores documentados para próxima iteración

## Mutable Scope
- webapp/index.html

## Immutable Files
- .autodebug/eval.py
- .autodebug/debug_program.md

## Hypotheses (ranked)
1. dlpColorMode/dlpResonanceVal/dlpContrastVal no están en saveSettings
2. CSS specificity conflict: warm+lgcy+dolphin themes
3. touchmove no cancela hold timer en slots
4. SCALE hardcoded en _buildCaskiaOverlay

## Time Budget
- Max experiments: 10
- Scope: static analysis + code review
