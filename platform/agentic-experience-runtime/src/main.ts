import { initFederation } from '@angular-architects/native-federation';

// Initialize Native Federation (shared deps + the remote import map) BEFORE
// bootstrapping, so federated component remotes can be loaded at runtime.
initFederation('federation.manifest.json')
  .catch((err) => console.error(err))
  .then(() => import('./bootstrap'))
  .catch((err) => console.error(err));
