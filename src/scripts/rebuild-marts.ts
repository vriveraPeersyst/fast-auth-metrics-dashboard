import { prisma } from "@/lib/prisma";
import { rebuildRelayerMarts } from "@/lib/indexers/near";

async function main() {
  const result = await rebuildRelayerMarts(prisma);
  console.log(JSON.stringify({ rebuilt: result }, null, 2));
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
