import { create } from 'zustand';

export type AppView = 'home' | 'standard-import';

type NavStoreState = {
  view: AppView;
  setView(view: AppView): void;
};

export const useNavStore = create<NavStoreState>((set) => ({
  view: 'home',
  setView(view) {
    set({ view });
  },
}));
