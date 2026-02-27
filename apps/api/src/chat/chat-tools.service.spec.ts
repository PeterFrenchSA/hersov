import { ContactMethodType } from '@prisma/client';
import { ChatToolsService } from './chat-tools.service';

describe('ChatToolsService', () => {
  const createService = () => {
    const prismaMock: any = {
      contact: {
        findMany: jest.fn(async () => [
          {
            id: 'c1',
            fullName: 'Jane Doe',
            currentTitle: 'Partner',
            locationCountry: 'United Kingdom',
            currentCompany: { name: 'Acme' },
            contactMethods: [
              { type: ContactMethodType.EMAIL, value: 'jane@example.com' },
              { type: ContactMethodType.PHONE, value: '+441234' },
            ],
          },
        ]),
        findUnique: jest.fn(async () => null),
      },
      $queryRawUnsafe: jest.fn(async () => []),
      contactMethod: {
        findMany: jest.fn(async () => []),
      },
    };

    const semanticServiceMock = {
      semanticSearch: jest.fn(async () => []),
    };

    return {
      service: new ChatToolsService(prismaMock, semanticServiceMock as never),
    };
  };

  it('validates args and redacts sensitive fields for ReadOnly', async () => {
    const { service } = createService();

    const result = await service.executeTool(
      'crm.searchContacts',
      JSON.stringify({ limit: 5, includeSensitive: true }),
      {
        userRole: 'ReadOnly',
        sensitiveRequestAllowed: true,
      },
    );

    expect(result.output).toMatchObject({
      includeSensitive: false,
    });
    expect(JSON.stringify(result.output)).not.toContain('jane@example.com');
  });

  it('allows sensitive fields only for Admin/Analyst when explicitly requested', async () => {
    const { service } = createService();

    const result = await service.executeTool(
      'crm.searchContacts',
      JSON.stringify({ limit: 5, includeSensitive: true }),
      {
        userRole: 'Admin',
        sensitiveRequestAllowed: true,
      },
    );

    expect(result.output).toMatchObject({
      includeSensitive: true,
    });
    expect(JSON.stringify(result.output)).toContain('jane@example.com');
  });

  it('throws for invalid tool argument JSON', async () => {
    const { service } = createService();

    await expect(
      service.executeTool('crm.searchContacts', '{', {
        userRole: 'Admin',
        sensitiveRequestAllowed: true,
      }),
    ).rejects.toThrow('Invalid tool arguments JSON');
  });
});
