import { Registry } from './engine/core/registry';
import { mountInspector } from './engine/core/inspector';

const registry = new Registry();
if (new URLSearchParams(location.search).has('inspect')) mountInspector(registry);
