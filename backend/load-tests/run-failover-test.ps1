Write-Host "=========================================================="
Write-Host "PHASE 6B: WORKER FAILURE DURING LOAD TEST"
Write-Host "=========================================================="

$preMeta = (Invoke-RestMethod "http://localhost:3001/api/jobs?limit=1").meta
$preCompleted = (Invoke-RestMethod "http://localhost:3001/api/jobs?status=COMPLETED&limit=1").meta.total
$preTotal = $preMeta.total

Write-Host "Pre-test state -> Total in DB: $preTotal | Completed: $preCompleted"
Write-Host "Active workers before test: 3 (backend-worker-1, backend-worker-2, backend-worker-3)"

# Launch k6 in background
Write-Host "Starting k6 50-VU 30s load test..."
$k6Process = Start-Process -FilePath "k6.exe" -ArgumentList "run", "load-tests/load-failover.js" -NoNewWindow -PassThru

# Wait 15 seconds into the test so workers are fully saturated
Write-Host "Allowing 15 seconds for queue buildup and full worker saturation..."
Start-Sleep -Seconds 15

# Check processing jobs before kill
$procBeforeKill = (Invoke-RestMethod "http://localhost:3001/api/jobs?status=PROCESSING&limit=1").meta.total
$queueBeforeKill = docker exec taskflow-redis redis-cli LLEN taskflow:jobs:normal
Write-Host "At T=15s -> Redis Queue: $queueBeforeKill | Actively Processing: $procBeforeKill"

# DELIBERATELY KILL WORKER 3
$killTime = Get-Date
Write-Host ">>> KILLING WORKER CONTAINER backend-worker-3 AT $killTime <<<"
docker stop backend-worker-3 | Out-Null
Write-Host "backend-worker-3 STOPPED."

# Check how many jobs were held by Worker 3 (hostname: 16740ee1)
$orphansHeld = docker exec backend-worker-1 node -e "
const mongoose = require('mongoose');
require('dotenv').config();
mongoose.connect(process.env.MONGODB_URI).then(async () => {
  const count = await mongoose.connection.db.collection('jobs').countDocuments({
    status: 'PROCESSING',
    leasedBy: '16740ee1'
  });
  console.log(count);
  process.exit(0);
});
"
Write-Host "Jobs actively leased by killed worker (16740ee1) at time of crash: $orphansHeld"

# Wait for k6 process to finish
Write-Host "Waiting for k6 submission to complete..."
$k6Process.WaitForExit()
Write-Host "k6 submission finished!"

# Now monitor the recovery and queue drain
Write-Host ""
Write-Host "Monitoring Lease Expiration and Reaper Recovery..."
$startRecoveryWatch = Get-Date

while ($true) {
    Start-Sleep -Seconds 10
    $norm = docker exec taskflow-redis redis-cli LLEN taskflow:jobs:normal
    $p = (Invoke-RestMethod "http://localhost:3001/api/jobs?status=PROCESSING&limit=1").meta.total
    $c = (Invoke-RestMethod "http://localhost:3001/api/jobs?status=COMPLETED&limit=1").meta.total
    $elapsed = [math]::Round(((Get-Date) - $startRecoveryWatch).TotalSeconds, 1)
    
    # Check if any jobs are still held by the dead worker
    $deadHeld = docker exec backend-worker-1 node -e "
const mongoose = require('mongoose');
require('dotenv').config();
mongoose.connect(process.env.MONGODB_URI).then(async () => {
  const count = await mongoose.connection.db.collection('jobs').countDocuments({
    status: 'PROCESSING',
    leasedBy: '16740ee1'
  });
  console.log(count);
  process.exit(0);
});
"
    Write-Host "  [+${elapsed}s] Redis Queue: $norm | Processing: $p (Held by dead worker: $deadHeld) | Completed: $c"

    if ([int]$norm -eq 0 -and [int]$p -eq 0) {
        Write-Host "ALL JOBS DRAINED AND COMPLETED AT $(Get-Date)!"
        break
    }
}

Write-Host "=========================================================="
Write-Host "TEST AND RECOVERY COMPLETE."
Write-Host "=========================================================="
