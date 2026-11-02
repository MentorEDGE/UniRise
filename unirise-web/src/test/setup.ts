import { beforeEach } from "vitest";
import { resetDb } from "@/mock/store";

beforeEach(() => { resetDb(); sessionStorage.clear(); });
