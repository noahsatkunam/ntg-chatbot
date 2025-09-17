import FormData from 'form-data';

import { ApiConnector, ApiRequest, ApiResponse } from '../../apiConnector';
import { SlackConnector } from '../slackConnector';

describe('SlackConnector.uploadFile', () => {
  it('uploads buffers using node FormData implementation', async () => {
    const connectionId = 'conn-123';
    const tenantId = 'tenant-abc';
    const payload: Buffer = Buffer.from('hello slack file');
    const filename = 'greeting.txt';
    const channels = ['C123456'];
    const title = 'Greetings';
    const initialComment = 'File upload test';

    const apiResponse: ApiResponse = {
      success: true,
      statusCode: 200,
      headers: {},
      duration: 10,
      data: { ok: true }
    };

    const makeRequest = jest
      .fn<Promise<ApiResponse>, [string, ApiRequest, string]>()
      .mockResolvedValue(apiResponse);

    const connector = new SlackConnector({
      makeRequest
    } as unknown as ApiConnector);

    const result = await connector.uploadFile(
      connectionId,
      tenantId,
      payload,
      filename,
      channels,
      title,
      initialComment
    );

    expect(result).toEqual(apiResponse);
    expect(makeRequest).toHaveBeenCalledWith(
      connectionId,
      expect.objectContaining({
        method: 'POST',
        endpoint: '/api/files.upload'
      }),
      tenantId
    );

    const requestArg = makeRequest.mock.calls[0][1];
    const formData = requestArg.data as FormData;
    expect(formData).toBeInstanceOf(FormData);

    const headers = requestArg.headers as Record<string, string>;
    expect(headers['Content-Type']).toMatch(/^multipart\/form-data; boundary=/);
    expect(headers).not.toHaveProperty('content-type');

    const serializedBody = formData.getBuffer().toString();
    expect(serializedBody).toContain('hello slack file');
    expect(serializedBody).toContain(`name="file"; filename="${filename}"`);
    expect(serializedBody).toContain('name="channels"');
    expect(serializedBody).toContain(channels[0]);
    expect(serializedBody).toContain('name="title"');
    expect(serializedBody).toContain(title);
    expect(serializedBody).toContain('name="initial_comment"');
    expect(serializedBody).toContain(initialComment);
  });
});
