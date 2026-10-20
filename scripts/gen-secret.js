// Genere un JWT_SECRET fort et verifie qu'il passe le controle de l'application (jamais un secret refuse au demarrage).
import crypto from 'node:crypto';
import { secretProblem } from '../server/lib/security.js';

let s;
do { s = crypto.randomBytes(32).toString('hex'); } while (secretProblem(s));
process.stdout.write(s);
