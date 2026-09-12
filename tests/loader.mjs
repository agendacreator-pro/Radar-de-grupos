// Registra o hook de resolução do alias "@/" para testes node:test com
// type-stripping (Node ≥ 23.6 sem flags). Deve ser carregado ANTES do
// grafo de módulos dos testes: use --import ./tests/loader.mjs.
import { register } from "node:module";

register(new URL("./hooks.mjs", import.meta.url));