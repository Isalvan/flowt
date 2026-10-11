import { useContext } from 'react';
import { BanksContext } from '../context/bankContext';

export function useBanks() { return useContext(BanksContext); }
