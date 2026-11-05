import type { ToolCheck } from '../shared/types';
import { resolveClaude } from './claude';
import { findGit } from './git';

/** Solo comprueba que los programas existan: saber si hay sesión iniciada en Claude exigiría leer credenciales. */
export function checkTools(claudePath: string): ToolCheck {
  return { claude: resolveClaude(claudePath), git: findGit() };
}
