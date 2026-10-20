import { Router } from 'express';
import { demoInfo } from '../lib/demo.js';

export const demoRouter = Router();
// Public (la page de connexion l'appelle avant toute authentification).
demoRouter.get('/', (req, res) => res.json(demoInfo()));
