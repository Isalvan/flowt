import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { initializeApp } from "firebase/app";
import { getFirestore, collection, query, where, getDocs, doc, updateDoc, Timestamp } from "firebase/firestore";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Cargar y parsear manualmente el archivo .env de la raíz
const envPath = path.join(__dirname, '../../.env');
const envContent = fs.readFileSync(envPath, 'utf8');
const env = {};
envContent.split('\n').forEach(line => {
  const match = line.match(/^\s*([\w.-]+)\s*=\s*(.*)?\s*$/);
  if (match) {
    let value = match[2] ? match[2].trim() : '';
    if (value.startsWith('"') && value.endsWith('"')) {
      value = value.substring(1, value.length - 1);
    }
    env[match[1]] = value;
  }
});

const firebaseConfig = {
  apiKey: env.VITE_FIREBASE_API_KEY,
  authDomain: env.VITE_FIREBASE_AUTH_DOMAIN,
  projectId: env.VITE_FIREBASE_PROJECT_ID,
  storageBucket: env.VITE_FIREBASE_STORAGE_BUCKET,
  messagingSenderId: env.VITE_FIREBASE_MESSAGING_SENDER_ID,
  appId: env.VITE_FIREBASE_APP_ID
};

const app = initializeApp(firebaseConfig);
const db = getFirestore(app);

const UID_PROPIETARIO = "4Jjrmc7VBtfQMvfpfgrTuGmA6D12";

function parseDateString(raw_fecha) {
  if (!raw_fecha) return null;
  
  try {
    // Si tiene formato de header de correo (contiene coma o similar)
    if (raw_fecha.includes(',') || (raw_fecha.includes('+') && raw_fecha.length > 15)) {
      const parsed = Date.parse(raw_fecha);
      if (!isNaN(parsed)) return new Date(parsed);
    }
    
    // Intentar formato ISO
    if (raw_fecha.includes('T')) {
      const parsed = Date.parse(raw_fecha);
      if (!isNaN(parsed)) return new Date(parsed);
    } else if (raw_fecha.includes('-')) {
      // Formato YYYY-MM-DD
      const parts = raw_fecha.split('-');
      if (parts.length === 3) {
        return new Date(Date.UTC(parseInt(parts[0]), parseInt(parts[1]) - 1, parseInt(parts[2])));
      }
    } else if (raw_fecha.includes('/')) {
      // Formato DD/MM/YYYY
      const parts = raw_fecha.split('/');
      if (parts.length === 3) {
        let day = parseInt(parts[0]);
        let month = parseInt(parts[1]);
        let year = parseInt(parts[2]);
        if (year < 100) year += 2000;
        return new Date(Date.UTC(year, month - 1, day));
      }
    }
  } catch (e) {
    console.error(`Error parsing date ${raw_fecha}:`, e);
  }
  
  return null;
}

async function main() {
  console.log("--- INICIANDO MIGRACIÓN DE FECHAS EN FIRESTORE (NODE.JS) ---");
  console.log(`Buscando movimientos para el usuario: ${UID_PROPIETARIO}...`);
  
  try {
    const q = query(
      collection(db, "movimientos"),
      where("id_propietario", "==", UID_PROPIETARIO)
    );
    const querySnapshot = await getDocs(q);
    console.log(`Se encontraron ${querySnapshot.size} movimientos en total.`);
    
    let updatedCount = 0;
    
    for (const document of querySnapshot.docs) {
      const data = document.data();
      const fechaVal = data.fecha_operacion;
      
      // En el SDK de cliente, las fechas en formato de texto son cadenas string
      if (typeof fechaVal === "string") {
        console.log(`\nDetectado movimiento con fecha en formato String:`);
        console.log(`  ID: ${document.id}`);
        console.log(`  Concepto: ${data.concepto}`);
        console.log(`  Fecha String: '${fechaVal}'`);
        
        let fecha_dt = parseDateString(fechaVal);
        if (!fecha_dt) {
          fecha_dt = new Date();
        }
        
        console.log(`  -> Convirtiendo a Timestamp:`, fecha_dt.toISOString());
        
        // Actualizar en Firestore
        const docRef = doc(db, "movimientos", document.id);
        await updateDoc(docRef, {
          fecha_operacion: Timestamp.fromDate(fecha_dt)
        });
        updatedCount++;
      }
    }
    
    console.log(`\n--- MIGRACIÓN COMPLETADA ---`);
    console.log(`Total de movimientos actualizados a Timestamp: ${updatedCount}`);
    process.exit(0);
  } catch (err) {
    console.error("Error durante la migración:", err);
    process.exit(1);
  }
}

main();
