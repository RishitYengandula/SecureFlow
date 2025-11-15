import asyncio
from app import classify, ClassifyRequest

async def run():
    samples = [
        "The employee is undergoing chemotherapy and will be out for months.",
        "We are planning a merger next quarter and expect revenue to increase.",
        "Project Atlas must be launched before Q4, do not share outside R&D.",
        "The defense prototype will be tested next month in a secure facility.",
        "Contact john.doe@acme.com for details about the account 12345678.",
    ]

    for s in samples:
        res = await classify(ClassifyRequest(text=s))
        print("INPUT:", s)
        print("OUTPUT:", res)
        print("---")

if __name__ == '__main__':
    asyncio.run(run())
