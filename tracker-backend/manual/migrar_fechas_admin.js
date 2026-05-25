import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import admin from 'firebase-admin';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// 1. Cargar clave de cuenta de servicio de Firestore
const serviceAccountPath = path.join(__dirname, '../serviceAccountKey.json');
if (!fs.existsSync(serviceAccountPath)) {
  console.error("ERROR: No se encuentra 'tracker-backend/serviceAccountKey.json'.");
  process.exit(1);
}
const serviceAccount = JSON.parse(fs.readFileSync(serviceAccountPath, 'utf8'));

// 2. Inicializar firebase-admin en modo administrador
admin.initializeApp({
  credential: admin.credential.cert(serviceAccount)
});

const db = admin.firestore();
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
  console.log("--- INICIANDO MIGRACIÓN DE FECHAS EN FIRESTORE (ADMIN SDK) ---");
  console.log(`Buscando movimientos para el usuario: ${UID_PROPIETARIO}...`);
  
  try {
    const querySnapshot = await db.collection("movimientos")
      .where("id_propietario", "==", UID_PROPIETARIO)
      .get();
      
    console.log(`Se encontraron ${querySnapshot.size} movimientos en total.`);
    
    let updatedCount = 0;
    
    for (const docSnapshot of querySnapshot.docs) {
      const data = docSnapshot.data();
      const fechaVal = data.fecha_operacion;
      
      // En el SDK Admin, las fechas guardadas como String son de tipo 'string'
      if (typeof fechaVal === "string") {
        console.log(`\nDetectado movimiento con fecha en formato String:`);
        console.log(`  ID: ${docSnapshot.id}`);
        console.log(`  Concepto: ${data.concepto}`);
        console.log(`  Fecha String: '${fechaVal}'`);
        
        let fecha_dt = parseDateString(fechaVal);
        if (!fecha_dt) {
          fecha_dt = new Date();
        }
        
        console.log(`  -> Convirtiendo a Timestamp:`, fecha_dt.toISOString());
        
        // Actualizar en Firestore
        await docSnapshot.ref.update({
          fecha_operacion: admin.firestore.Timestamp.fromDate(fecha_dt)
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
